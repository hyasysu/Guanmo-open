fn main() {
    // permissions/main.toml 的显式命令清单让自定义 command 进入应用 ACL。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new()),
    )
    .expect("failed to build Tauri permissions")
}
