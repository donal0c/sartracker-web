mod persistence;

use std::sync::Arc;

use tauri::Manager;

use persistence::{
    build_mission_store, create_mission, finish_mission, get_active_mission, get_mission,
    get_recoverable_mission, list_missions, mission_store_info, pause_mission, resume_mission,
    sync_mission_store_backup, MissionStoreState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .setup(|app| {
            let mission_store = tauri::async_runtime::block_on(build_mission_store(app.handle()))?;
            app.manage(MissionStoreState(Arc::new(mission_store)));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mission_store_info,
            sync_mission_store_backup,
            create_mission,
            get_mission,
            list_missions,
            get_active_mission,
            get_recoverable_mission,
            pause_mission,
            resume_mission,
            finish_mission
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
