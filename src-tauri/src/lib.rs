mod persistence;

use std::sync::Arc;

use tauri::Manager;

use persistence::{
    add_position, build_mission_store, create_mission, delete_drawing, delete_marker,
    create_mission_archive, finish_mission, get_active_mission, get_device, get_drawing,
    get_marker, get_mission, get_recoverable_mission, latest_positions, list_devices,
    list_drawings, list_markers, list_mission_events, list_missions, list_positions, mission_store_info,
    pause_mission, resume_mission, sync_mission_store_backup, upsert_device, upsert_drawing,
    upsert_marker, MissionStoreState,
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
            create_mission_archive,
            create_mission,
            upsert_device,
            get_device,
            list_devices,
            add_position,
            list_positions,
            latest_positions,
            list_mission_events,
            upsert_marker,
            get_marker,
            list_markers,
            delete_marker,
            upsert_drawing,
            get_drawing,
            list_drawings,
            delete_drawing,
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
