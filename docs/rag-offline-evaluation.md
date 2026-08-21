# RAG 离线评测基线

运行 `npm run test:rag-eval`。评测只使用 `tests/rag/fixtures/offlineEvaluation.json` 中的匿名固定数据，在内存中执行，不读取用户文件或 SQLite。

当前 baseline 固定现有关键词、向量融合、阈值和多文档多样化逻辑，输出 Recall@K、MRR、NDCG@K、来源准确率、无答案误召回率、groundedness，以及冷启动和热查询延迟。质量指标由 runner 设为确定性门禁；延迟仅记录用于同机同环境版本对比，不设置跨机器阈值。

后续调整检索权重、阈值、排序或引入新策略时，应在同一模型、同一 Fixture、同一机器环境下保存修改前后 JSON 输出并比较；不得用延迟波动解释质量回退。
