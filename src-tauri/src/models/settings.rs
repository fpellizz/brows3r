use serde::{Deserialize, Serialize};
use specta::Type;

use crate::transfer::throttle::BandwidthSchedule;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub transfer: TransferSettings,
    pub ui: UiSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GeneralSettings {
    pub language: String,
    pub check_updates: bool,
    pub log_level: String,
    pub http_log_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TransferSettings {
    pub max_concurrent_transfers: u32,
    pub max_concurrent_parts: u32,
    pub multipart_threshold_mb: u32,
    pub part_size_mb: u32,
    pub max_bandwidth_mbps: Option<u32>,
    pub bandwidth_schedules: Vec<BandwidthSchedule>,
    pub verify_checksum: bool,
    pub retry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UiSettings {
    pub theme: Theme,
    pub sidebar_width: u32,
    pub show_transfer_panel: bool,
    pub show_terminal_panel: bool,
    pub show_details_panel: bool,
    pub default_view: ObjectView,
    pub confirm_delete: bool,
    pub date_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ObjectView {
    Hierarchical,
    Flat,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                language: "en".to_string(),
                check_updates: true,
                log_level: "info".to_string(),
                http_log_enabled: false,
            },
            transfer: TransferSettings {
                max_concurrent_transfers: 4,
                max_concurrent_parts: 4,
                multipart_threshold_mb: 100,
                part_size_mb: 8,
                max_bandwidth_mbps: None,
                bandwidth_schedules: vec![],
                verify_checksum: true,
                retry_count: 3,
            },
            ui: UiSettings {
                theme: Theme::System,
                sidebar_width: 260,
                show_transfer_panel: true,
                show_terminal_panel: false,
                show_details_panel: false,
                default_view: ObjectView::Hierarchical,
                confirm_delete: true,
                date_format: "yyyy-MM-dd HH:mm".to_string(),
            },
        }
    }
}
