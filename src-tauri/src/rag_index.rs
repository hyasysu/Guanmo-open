use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum IndexStatus {
    #[default]
    Idle,
    Initializing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexStateResponse {
    status: IndexStatus,
    document_count: usize,
    chunk_count: usize,
    valid_vector_count: usize,
    skipped_vector_count: usize,
    error: Option<String>,
}

#[derive(Clone, Debug)]
enum PendingChange {
    Refresh,
    Remove,
}

#[derive(Default)]
struct IndexControl {
    status: IndexStatus,
    index: Option<Arc<RwLock<RagIndex>>>,
    skipped_vectors: usize,
    error: Option<String>,
    pending_changes: HashMap<String, PendingChange>,
}

#[derive(Default)]
pub struct RagIndexService {
    control: Mutex<IndexControl>,
    notify: tokio::sync::Notify,
}

#[derive(Clone, Debug)]
struct DocumentRecord {
    id: String,
    file_path: String,
    title: String,
    last_modified: i64,
}

#[derive(Clone, Debug)]
struct ChunkRecord {
    id: String,
    document_id: String,
    content: String,
    content_hash: Option<String>,
    index: i64,
    start_line: i64,
    end_line: i64,
    title_path: Vec<String>,
    heading: Option<String>,
    source_type: String,
    embedding: Option<Vec<f32>>,
}

#[derive(Default)]
struct RagIndex {
    documents: HashMap<String, DocumentRecord>,
    chunks: Vec<ChunkRecord>,
    vector_dimension: Option<usize>,
}

#[derive(Clone, Debug)]
struct RawDocument {
    id: String,
    file_path: String,
    title: String,
    last_modified: i64,
}

#[derive(Clone, Debug)]
struct RawChunk {
    id: String,
    document_id: String,
    content: String,
    content_hash: Option<String>,
    index: i64,
    start_line: i64,
    end_line: i64,
    title_path: Option<String>,
    heading: Option<String>,
    source_type: String,
    embedding: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchRequest {
    query_text: String,
    query_vector: Option<Vec<f32>>,
    top_k: usize,
    threshold: f32,
    #[serde(default)]
    file_paths: Vec<String>,
    #[serde(default = "default_true")]
    keyword_search_enabled: bool,
    current_file_path: Option<String>,
    #[serde(default)]
    prefer_current_file: bool,
    #[serde(default)]
    prefer_recent_documents: bool,
    #[serde(default)]
    keyword_only_fallback: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    chunk: RagSearchChunk,
    document: RagSearchDocument,
    score: f32,
    retrieval_mode: &'static str,
    keyword_score: Option<f32>,
    vector_score: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagSearchChunk {
    id: String,
    document_id: String,
    content: String,
    content_hash: Option<String>,
    index: i64,
    start_line: i64,
    end_line: i64,
    title_path: Vec<String>,
    heading: Option<String>,
    source_type: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagSearchDocument {
    id: String,
    file_path: String,
    title: String,
    last_modified: i64,
}

#[derive(Clone, Debug)]
struct RankedHit {
    chunk_index: usize,
    score: f32,
    keyword_score: Option<f32>,
    vector_score: Option<f32>,
    retrieval_mode: &'static str,
}

fn normalize_path(path: &str) -> String {
    let mut value = path.trim().replace('\\', "/").to_lowercase();
    if let Some(rest) = value.strip_prefix("//?/unc/") {
        value = format!("//{rest}");
    } else if let Some(rest) = value.strip_prefix("//?/") {
        value = rest.to_string();
    }
    while value.contains("//") && !value.starts_with("//") {
        value = value.replace("//", "/");
    }
    value
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("guanmo.db"))
        .map_err(|error| error.to_string())
}

async fn open_readonly_pool(path: PathBuf) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

async fn load_raw_index(
    pool: &SqlitePool,
    include_embeddings: bool,
) -> Result<(Vec<RawDocument>, Vec<RawChunk>), String> {
    let document_rows = sqlx::query("SELECT id, file_path, title, last_modified FROM documents")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let chunk_query = if include_embeddings {
        "SELECT c.id, c.document_id, c.content, c.content_hash, c.chunk_index, c.start_line, \
         c.end_line, c.title_path, c.heading, c.source_type, CAST(e.embedding AS TEXT) AS embedding \
         FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id ORDER BY c.document_id, c.chunk_index"
    } else {
        "SELECT c.id, c.document_id, c.content, c.content_hash, c.chunk_index, c.start_line, \
         c.end_line, c.title_path, c.heading, c.source_type, NULL AS embedding \
         FROM chunks c ORDER BY c.document_id, c.chunk_index"
    };
    let chunk_rows = sqlx::query(chunk_query)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let documents = document_rows
        .into_iter()
        .map(|row| RawDocument {
            id: row.get("id"),
            file_path: row.get("file_path"),
            title: row.get("title"),
            last_modified: row.get("last_modified"),
        })
        .collect();
    let chunks = chunk_rows
        .into_iter()
        .map(|row| RawChunk {
            id: row.get("id"),
            document_id: row.get("document_id"),
            content: row.get("content"),
            content_hash: row.get("content_hash"),
            index: row.get("chunk_index"),
            start_line: row.get("start_line"),
            end_line: row.get("end_line"),
            title_path: row.get("title_path"),
            heading: row.get("heading"),
            source_type: row.get("source_type"),
            embedding: row.get("embedding"),
        })
        .collect();
    Ok((documents, chunks))
}

async fn load_raw_document(
    pool: &SqlitePool,
    file_path: &str,
) -> Result<Option<(RawDocument, Vec<RawChunk>)>, String> {
    let rows = sqlx::query("SELECT id, file_path, title, last_modified FROM documents")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let target = normalize_path(file_path);
    let Some(row) = rows
        .into_iter()
        .find(|row| normalize_path(row.get::<String, _>("file_path").as_str()) == target)
    else {
        return Ok(None);
    };
    let document = RawDocument {
        id: row.get("id"),
        file_path: row.get("file_path"),
        title: row.get("title"),
        last_modified: row.get("last_modified"),
    };
    let chunk_rows = sqlx::query(
        "SELECT c.id, c.document_id, c.content, c.content_hash, c.chunk_index, c.start_line, \
         c.end_line, c.title_path, c.heading, c.source_type, CAST(e.embedding AS TEXT) AS embedding \
         FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id \
         WHERE c.document_id = ? ORDER BY c.chunk_index"
    ).bind(&document.id).fetch_all(pool).await.map_err(|error| error.to_string())?;
    let chunks = chunk_rows
        .into_iter()
        .map(|row| RawChunk {
            id: row.get("id"),
            document_id: row.get("document_id"),
            content: row.get("content"),
            content_hash: row.get("content_hash"),
            index: row.get("chunk_index"),
            start_line: row.get("start_line"),
            end_line: row.get("end_line"),
            title_path: row.get("title_path"),
            heading: row.get("heading"),
            source_type: row.get("source_type"),
            embedding: row.get("embedding"),
        })
        .collect();
    Ok(Some((document, chunks)))
}

fn parse_embedding(value: Option<String>) -> Option<Vec<f32>> {
    let vector: Vec<f32> = serde_json::from_str(value?.as_str()).ok()?;
    (!vector.is_empty() && vector.iter().all(|item| item.is_finite())).then_some(vector)
}

fn parse_title_path(value: Option<String>) -> Vec<String> {
    value
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn build_index(documents: Vec<RawDocument>, chunks: Vec<RawChunk>) -> (RagIndex, usize) {
    let parsed: Vec<Option<Vec<f32>>> = chunks
        .iter()
        .map(|chunk| parse_embedding(chunk.embedding.clone()))
        .collect();
    let mut dimensions = HashMap::<usize, usize>::new();
    for vector in parsed.iter().flatten() {
        *dimensions.entry(vector.len()).or_default() += 1;
    }
    let dimension = dimensions
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(dimension, _)| dimension);
    let mut skipped = 0;
    let chunks = chunks
        .into_iter()
        .zip(parsed)
        .map(|(chunk, vector)| {
            let embedding = match (vector, dimension) {
                (Some(vector), Some(expected)) if vector.len() == expected => Some(vector),
                (Some(_), _) => {
                    skipped += 1;
                    None
                }
                (None, _) => {
                    if chunk.embedding.is_some() {
                        skipped += 1;
                    }
                    None
                }
            };
            ChunkRecord {
                id: chunk.id,
                document_id: chunk.document_id,
                content: chunk.content,
                content_hash: chunk.content_hash,
                index: chunk.index,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                title_path: parse_title_path(chunk.title_path),
                heading: chunk.heading,
                source_type: chunk.source_type,
                embedding,
            }
        })
        .collect();
    let documents = documents
        .into_iter()
        .map(|doc| {
            (
                doc.id.clone(),
                DocumentRecord {
                    id: doc.id,
                    file_path: doc.file_path,
                    title: doc.title,
                    last_modified: doc.last_modified,
                },
            )
        })
        .collect();
    (
        RagIndex {
            documents,
            chunks,
            vector_dimension: dimension,
        },
        skipped,
    )
}

fn state_response(control: &IndexControl) -> RagIndexStateResponse {
    let (document_count, chunk_count, valid_vector_count) = control
        .index
        .as_ref()
        .and_then(|index| index.read().ok())
        .map(|index| {
            (
                index.documents.len(),
                index.chunks.len(),
                index
                    .chunks
                    .iter()
                    .filter(|chunk| chunk.embedding.is_some())
                    .count(),
            )
        })
        .unwrap_or_default();
    RagIndexStateResponse {
        status: control.status,
        document_count,
        chunk_count,
        valid_vector_count,
        skipped_vector_count: control.skipped_vectors,
        error: control.error.clone(),
    }
}

async fn apply_pending_changes(
    app: &AppHandle,
    service: &RagIndexService,
    pool: &SqlitePool,
) -> Result<(), String> {
    loop {
        let changes = {
            let mut control = service
                .control
                .lock()
                .map_err(|_| "RAG index state poisoned".to_string())?;
            if control.pending_changes.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut control.pending_changes)
        };
        for (path, change) in changes {
            match change {
                PendingChange::Refresh => refresh_ready_index(pool, service, &path).await?,
                PendingChange::Remove => remove_ready_index(service, &path)?,
            }
        }
        let _ = app;
    }
}

async fn initialize_internal(
    app: &AppHandle,
    service: &RagIndexService,
) -> Result<RagIndexStateResponse, String> {
    loop {
        let should_initialize = {
            let mut control = service
                .control
                .lock()
                .map_err(|_| "RAG index state poisoned".to_string())?;
            match control.status {
                IndexStatus::Ready => return Ok(state_response(&control)),
                IndexStatus::Initializing => false,
                IndexStatus::Idle | IndexStatus::Failed => {
                    control.status = IndexStatus::Initializing;
                    control.error = None;
                    true
                }
            }
        };
        if !should_initialize {
            tokio::select! {
                _ = service.notify.notified() => {},
                _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {},
            }
            continue;
        }

        let result: Result<RagIndexStateResponse, String> = async {
            let pool = open_readonly_pool(database_path(app)?).await?;
            let (documents, chunks) = load_raw_index(&pool, true).await?;
            let (index, skipped) =
                tauri::async_runtime::spawn_blocking(move || build_index(documents, chunks))
                    .await
                    .map_err(|error| error.to_string())?;
            {
                let mut control = service
                    .control
                    .lock()
                    .map_err(|_| "RAG index state poisoned".to_string())?;
                control.index = Some(Arc::new(RwLock::new(index)));
                control.skipped_vectors = skipped;
            }
            apply_pending_changes(app, service, &pool).await?;
            let mut control = service
                .control
                .lock()
                .map_err(|_| "RAG index state poisoned".to_string())?;
            control.status = IndexStatus::Ready;
            Ok(state_response(&control))
        }
        .await;

        if let Err(error) = &result {
            if let Ok(mut control) = service.control.lock() {
                control.status = IndexStatus::Failed;
                control.index = None;
                control.error = Some(error.clone());
            }
        }
        service.notify.notify_waiters();
        return result;
    }
}

#[tauri::command]
pub fn get_rag_index_state(
    state: State<'_, RagIndexService>,
) -> Result<RagIndexStateResponse, String> {
    let control = state
        .control
        .lock()
        .map_err(|_| "RAG index state poisoned".to_string())?;
    Ok(state_response(&control))
}

#[tauri::command]
pub async fn initialize_rag_index(
    app: AppHandle,
    state: State<'_, RagIndexService>,
) -> Result<RagIndexStateResponse, String> {
    initialize_internal(&app, state.inner()).await
}

async fn refresh_ready_index(
    pool: &SqlitePool,
    service: &RagIndexService,
    path: &str,
) -> Result<(), String> {
    let raw = load_raw_document(pool, path).await?;
    let control = service
        .control
        .lock()
        .map_err(|_| "RAG index state poisoned".to_string())?;
    let Some(index) = control.index.clone() else {
        return Ok(());
    };
    drop(control);
    let mut index = index
        .write()
        .map_err(|_| "RAG index poisoned".to_string())?;
    let normalized = normalize_path(path);
    index
        .documents
        .retain(|_, doc| normalize_path(&doc.file_path) != normalized);
    let document_ids: HashSet<String> = index.documents.keys().cloned().collect();
    index
        .chunks
        .retain(|chunk| document_ids.contains(&chunk.document_id));
    if let Some((document, chunks)) = raw {
        let (fresh, _) = build_index(vec![document], chunks);
        index.documents.extend(fresh.documents);
        let vector_dimension = index.vector_dimension;
        index
            .chunks
            .extend(fresh.chunks.into_iter().map(|mut chunk| {
                if chunk
                    .embedding
                    .as_ref()
                    .is_some_and(|vector| Some(vector.len()) != vector_dimension)
                {
                    chunk.embedding = None;
                }
                chunk
            }));
    }
    Ok(())
}

fn remove_ready_index(service: &RagIndexService, path: &str) -> Result<(), String> {
    let control = service
        .control
        .lock()
        .map_err(|_| "RAG index state poisoned".to_string())?;
    let Some(index) = control.index.clone() else {
        return Ok(());
    };
    drop(control);
    let normalized = normalize_path(path);
    let mut index = index
        .write()
        .map_err(|_| "RAG index poisoned".to_string())?;
    let removed_ids: HashSet<String> = index
        .documents
        .values()
        .filter(|doc| normalize_path(&doc.file_path) == normalized)
        .map(|doc| doc.id.clone())
        .collect();
    index.documents.retain(|id, _| !removed_ids.contains(id));
    index
        .chunks
        .retain(|chunk| !removed_ids.contains(&chunk.document_id));
    Ok(())
}

#[tauri::command]
pub async fn refresh_rag_index_document(
    app: AppHandle,
    path: String,
    state: State<'_, RagIndexService>,
) -> Result<(), String> {
    {
        let mut control = state
            .control
            .lock()
            .map_err(|_| "RAG index state poisoned".to_string())?;
        if control.status != IndexStatus::Ready {
            if control.status == IndexStatus::Initializing {
                control
                    .pending_changes
                    .insert(normalize_path(&path), PendingChange::Refresh);
            }
            return Ok(());
        }
    }
    let pool = open_readonly_pool(database_path(&app)?).await?;
    refresh_ready_index(&pool, state.inner(), &path).await
}

#[tauri::command]
pub fn remove_rag_index_document(
    path: String,
    state: State<'_, RagIndexService>,
) -> Result<(), String> {
    {
        let mut control = state
            .control
            .lock()
            .map_err(|_| "RAG index state poisoned".to_string())?;
        if control.status != IndexStatus::Ready {
            if control.status == IndexStatus::Initializing {
                control
                    .pending_changes
                    .insert(normalize_path(&path), PendingChange::Remove);
            }
            return Ok(());
        }
    }
    remove_ready_index(state.inner(), &path)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    let (mut dot, mut left_norm, mut right_norm) = (0.0, 0.0, 0.0);
    for (a, b) in left.iter().zip(right) {
        dot += a * b;
        left_norm += a * a;
        right_norm += b * b;
    }
    let denominator = left_norm.sqrt() * right_norm.sqrt();
    if denominator == 0.0 {
        0.0
    } else {
        dot / denominator
    }
}

fn tokenize(text: &str) -> Vec<String> {
    let normalized = text.to_lowercase();
    let mut terms = HashSet::new();
    let mut token = String::new();
    let mut token_is_cjk = false;
    let flush = |token: &mut String, is_cjk: bool, terms: &mut HashSet<String>| {
        let chars: Vec<char> = token.chars().collect();
        if chars.len() >= 2 {
            terms.insert(token.clone());
            if is_cjk && chars.len() > 3 {
                for pair in chars.windows(2) {
                    terms.insert(pair.iter().collect());
                }
            }
        }
        token.clear();
    };
    for ch in normalized.chars().chain(std::iter::once(' ')) {
        let is_cjk = ('\u{4e00}'..='\u{9fff}').contains(&ch);
        let is_ascii_term = ch.is_ascii_alphanumeric() || "_+#./-".contains(ch);
        if !is_cjk && !is_ascii_term {
            flush(&mut token, token_is_cjk, &mut terms);
        } else if token.is_empty() || token_is_cjk == is_cjk {
            token.push(ch);
            token_is_cjk = is_cjk;
        } else {
            flush(&mut token, token_is_cjk, &mut terms);
            token.push(ch);
            token_is_cjk = is_cjk;
        }
    }
    terms.into_iter().collect()
}

fn keyword_score(query: &str, terms: &[String], chunk: &ChunkRecord, doc: &DocumentRecord) -> f32 {
    if terms.is_empty() {
        return 0.0;
    }
    let content = chunk.content.to_lowercase();
    let heading = chunk.heading.as_deref().unwrap_or_default().to_lowercase();
    let title_path = chunk.title_path.join(" > ").to_lowercase();
    let file_name = doc
        .file_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&doc.title)
        .to_lowercase();
    let title = doc.title.to_lowercase();
    let mut score = 0.0;
    for term in terms {
        if content.contains(term) {
            score += 1.0;
        }
        if heading.contains(term) {
            score += 1.8;
        }
        if title_path.contains(term) {
            score += 1.5;
        }
        if file_name.contains(term) {
            score += 1.4;
        }
        if title.contains(term) {
            score += 1.2;
        }
    }
    let normalized = query.trim().to_lowercase();
    if normalized.chars().count() >= 3 {
        if content.contains(&normalized) {
            score += 1.2;
        }
        if title_path.contains(&normalized) || file_name.contains(&normalized) {
            score += 1.6;
        }
    }
    (score / terms.len() as f32).min(1.0)
}

fn apply_boost(mut hit: RankedHit, doc: &DocumentRecord, request: &RagSearchRequest) -> RankedHit {
    if request.prefer_current_file
        && request
            .current_file_path
            .as_ref()
            .is_some_and(|path| normalize_path(path) == normalize_path(&doc.file_path))
    {
        hit.score += 0.08;
    }
    if request.prefer_recent_documents {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let age = (now - doc.last_modified).max(0) as f32;
        let week = (7 * 24 * 60 * 60 * 1000) as f32;
        if age < week {
            hit.score += 0.04 * (1.0 - age / week);
        }
    }
    hit.score = hit.score.min(1.0);
    hit
}

fn sort_and_diversify(index: &RagIndex, hits: Vec<RankedHit>, top_k: usize) -> Vec<RankedHit> {
    let mut best = HashMap::<String, RankedHit>::new();
    for hit in hits {
        let chunk = &index.chunks[hit.chunk_index];
        let key = chunk
            .content_hash
            .clone()
            .unwrap_or_else(|| chunk.content.to_lowercase());
        if best
            .get(&key)
            .is_none_or(|current| hit.score > current.score)
        {
            best.insert(key, hit);
        }
    }
    let mut sorted: Vec<_> = best.into_values().collect();
    sorted.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    let mut groups = Vec::<Vec<RankedHit>>::new();
    let mut group_indexes = HashMap::<String, usize>::new();
    for hit in sorted {
        let path =
            normalize_path(&index.documents[&index.chunks[hit.chunk_index].document_id].file_path);
        let group_index = *group_indexes.entry(path).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[group_index].push(hit);
    }
    let mut output = Vec::new();
    while output.len() < top_k {
        let mut added = false;
        for group in &mut groups {
            if !group.is_empty() {
                output.push(group.remove(0));
                added = true;
            }
            if output.len() >= top_k {
                break;
            }
        }
        if !added {
            break;
        }
    }
    output
}

fn search_index(index: &RagIndex, request: &RagSearchRequest) -> Vec<RagSearchHit> {
    let scope: Option<HashSet<String>> = (!request.file_paths.is_empty()).then(|| {
        request
            .file_paths
            .iter()
            .map(|path| normalize_path(path))
            .collect()
    });
    let in_scope = |doc: &DocumentRecord| {
        scope
            .as_ref()
            .is_none_or(|paths| paths.contains(&normalize_path(&doc.file_path)))
    };
    let candidate_limit = request.top_k.saturating_mul(3).max(request.top_k);
    let mut vector_hits = Vec::new();
    if let Some(query) = request
        .query_vector
        .as_ref()
        .filter(|query| Some(query.len()) == index.vector_dimension)
    {
        for (chunk_index, chunk) in index.chunks.iter().enumerate() {
            let Some(vector) = &chunk.embedding else {
                continue;
            };
            let Some(doc) = index.documents.get(&chunk.document_id) else {
                continue;
            };
            if !in_scope(doc) {
                continue;
            }
            let score = cosine_similarity(query, vector);
            if score >= request.threshold {
                vector_hits.push(RankedHit {
                    chunk_index,
                    score,
                    vector_score: Some(score),
                    keyword_score: None,
                    retrieval_mode: "vector",
                });
            }
        }
    }
    let vector_hits = sort_and_diversify(index, vector_hits, candidate_limit);
    let mut keyword_hits = Vec::new();
    if request.keyword_search_enabled {
        let terms = tokenize(&request.query_text);
        for (chunk_index, chunk) in index.chunks.iter().enumerate() {
            let Some(doc) = index.documents.get(&chunk.document_id) else {
                continue;
            };
            if !in_scope(doc) {
                continue;
            }
            let score = keyword_score(&request.query_text, &terms, chunk, doc);
            if score > 0.0 {
                keyword_hits.push(apply_boost(
                    RankedHit {
                        chunk_index,
                        score,
                        vector_score: None,
                        keyword_score: Some(score),
                        retrieval_mode: "keyword",
                    },
                    doc,
                    request,
                ));
            }
        }
    }
    let keyword_hits = sort_and_diversify(index, keyword_hits, candidate_limit);
    let mut merged = HashMap::<String, RankedHit>::new();
    for hit in vector_hits.into_iter().chain(keyword_hits) {
        let chunk = &index.chunks[hit.chunk_index];
        let doc = &index.documents[&chunk.document_id];
        if let Some(existing) = merged.get(&chunk.id).cloned() {
            let vector_score = existing
                .vector_score
                .unwrap_or(0.0)
                .max(hit.vector_score.unwrap_or(0.0));
            let keyword_score = existing
                .keyword_score
                .unwrap_or(0.0)
                .max(hit.keyword_score.unwrap_or(0.0));
            let both = vector_score > 0.0 && keyword_score > 0.0;
            let score = if both {
                (vector_score * 0.72 + keyword_score * 0.28 + 0.04).min(1.0)
            } else {
                vector_score.max(keyword_score)
            };
            merged.insert(
                chunk.id.clone(),
                apply_boost(
                    RankedHit {
                        chunk_index: existing.chunk_index,
                        score,
                        vector_score: Some(vector_score),
                        keyword_score: Some(keyword_score),
                        retrieval_mode: if both {
                            "hybrid"
                        } else {
                            existing.retrieval_mode
                        },
                    },
                    doc,
                    request,
                ),
            );
        } else {
            merged.insert(chunk.id.clone(), apply_boost(hit, doc, request));
        }
    }
    sort_and_diversify(index, merged.into_values().collect(), request.top_k)
        .into_iter()
        .map(|hit| {
            let chunk = &index.chunks[hit.chunk_index];
            let doc = &index.documents[&chunk.document_id];
            RagSearchHit {
                chunk: RagSearchChunk {
                    id: chunk.id.clone(),
                    document_id: chunk.document_id.clone(),
                    content: chunk.content.clone(),
                    content_hash: chunk.content_hash.clone(),
                    index: chunk.index,
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    title_path: chunk.title_path.clone(),
                    heading: chunk.heading.clone(),
                    source_type: chunk.source_type.clone(),
                },
                document: RagSearchDocument {
                    id: doc.id.clone(),
                    file_path: doc.file_path.clone(),
                    title: doc.title.clone(),
                    last_modified: doc.last_modified,
                },
                score: hit.score,
                retrieval_mode: hit.retrieval_mode,
                keyword_score: hit.keyword_score,
                vector_score: hit.vector_score,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn search_rag_index(
    app: AppHandle,
    mut request: RagSearchRequest,
    state: State<'_, RagIndexService>,
) -> Result<Vec<RagSearchHit>, String> {
    if request.keyword_only_fallback {
        let pool = open_readonly_pool(database_path(&app)?).await?;
        let (documents, chunks) = load_raw_index(&pool, false).await?;
        request.query_vector = None;
        let (fallback, _) = build_index(documents, chunks);
        return tauri::async_runtime::spawn_blocking(move || search_index(&fallback, &request))
            .await
            .map_err(|error| error.to_string());
    }
    if initialize_internal(&app, state.inner()).await.is_err() {
        // Initialization failure must not block an answer. Retry a lightweight
        // keyword-only load; the failed state is retained so a later call can retry.
        let pool = open_readonly_pool(database_path(&app)?).await?;
        let (documents, chunks) = load_raw_index(&pool, false).await?;
        request.query_vector = None;
        let (fallback, _) = build_index(documents, chunks);
        return tauri::async_runtime::spawn_blocking(move || search_index(&fallback, &request))
            .await
            .map_err(|error| error.to_string());
    }
    let index = {
        let control = state
            .control
            .lock()
            .map_err(|_| "RAG index state poisoned".to_string())?;
        control
            .index
            .clone()
            .ok_or_else(|| "RAG index unavailable".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let index = index.read().map_err(|_| "RAG index poisoned".to_string())?;
        Ok(search_index(&index, &request))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn invalid_and_mismatched_vectors_are_skipped() {
        let documents = vec![RawDocument {
            id: "d".into(),
            file_path: "C:\\a.md".into(),
            title: "a".into(),
            last_modified: 0,
        }];
        let raw = |id: &str, embedding: &str| RawChunk {
            id: id.into(),
            document_id: "d".into(),
            content: id.into(),
            content_hash: None,
            index: 0,
            start_line: 1,
            end_line: 1,
            title_path: None,
            heading: None,
            source_type: "markdown".into(),
            embedding: Some(embedding.into()),
        };
        let (index, skipped) = build_index(
            documents,
            vec![
                raw("a", "[1,0]"),
                raw("b", "[0,1]"),
                raw("bad", "oops"),
                raw("dimension", "[1,2,3]"),
            ],
        );
        assert_eq!(index.vector_dimension, Some(2));
        assert_eq!(
            index
                .chunks
                .iter()
                .filter(|chunk| chunk.embedding.is_some())
                .count(),
            2
        );
        assert_eq!(skipped, 2);
    }

    #[test]
    fn tokenizer_keeps_ascii_and_chinese_terms_separate() {
        let terms: HashSet<String> = tokenize("Rust索引初始化").into_iter().collect();
        assert!(terms.contains("rust"));
        assert!(terms.contains("索引初始化"));
        assert!(terms.contains("索引"));
        assert!(!terms.contains("rust索引初始化"));
    }

    #[test]
    #[ignore = "reads the current user's installed Guanmo database"]
    fn local_database_initialization_profile() {
        let Some(app_data) = std::env::var_os("APPDATA") else {
            return;
        };
        let path = PathBuf::from(app_data)
            .join("com.guanmo.app")
            .join("guanmo.db");
        if !path.is_file() {
            return;
        }
        let started = Instant::now();
        let (documents, chunks) = tauri::async_runtime::block_on(async {
            let pool = open_readonly_pool(path).await.expect("open local database");
            load_raw_index(&pool, true)
                .await
                .expect("load local RAG rows")
        });
        let (index, skipped) = build_index(documents, chunks);
        println!(
            "local RAG profile: documents={}, chunks={}, vectors={}, skipped={}, elapsed_ms={}",
            index.documents.len(),
            index.chunks.len(),
            index
                .chunks
                .iter()
                .filter(|chunk| chunk.embedding.is_some())
                .count(),
            skipped,
            started.elapsed().as_millis(),
        );
        assert!(!index.documents.is_empty());
    }

    #[test]
    fn hybrid_search_preserves_scope_and_current_file_boost() {
        let documents = vec![
            RawDocument {
                id: "a".into(),
                file_path: "C:\\a.md".into(),
                title: "a".into(),
                last_modified: 0,
            },
            RawDocument {
                id: "b".into(),
                file_path: "C:\\b.md".into(),
                title: "b".into(),
                last_modified: 0,
            },
        ];
        let title_path = serde_json::to_string(&vec!["topic"]).unwrap();
        let raw = |id: &str, doc: &str, content: &str, embedding: &str| RawChunk {
            id: id.into(),
            document_id: doc.into(),
            content: content.into(),
            content_hash: Some(id.into()),
            index: 0,
            start_line: 1,
            end_line: 1,
            title_path: Some(title_path.clone()),
            heading: None,
            source_type: "markdown".into(),
            embedding: Some(embedding.into()),
        };
        let (index, _) = build_index(
            documents,
            vec![
                raw("a1", "a", "rust index", "[1,0]"),
                raw("b1", "b", "rust index", "[0.9,0.1]"),
            ],
        );
        let request = RagSearchRequest {
            query_text: "rust".into(),
            query_vector: Some(vec![1.0, 0.0]),
            top_k: 2,
            threshold: 0.0,
            file_paths: vec![],
            keyword_search_enabled: true,
            current_file_path: Some("c:/b.md".into()),
            prefer_current_file: true,
            prefer_recent_documents: false,
            keyword_only_fallback: false,
        };
        let hits = search_index(&index, &request);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].retrieval_mode, "hybrid");
        let scoped = RagSearchRequest {
            file_paths: vec!["c:/a.md".into()],
            ..request
        };
        assert_eq!(search_index(&index, &scoped).len(), 1);
    }
}
