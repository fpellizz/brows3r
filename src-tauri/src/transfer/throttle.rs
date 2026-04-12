use std::num::NonZeroU32;
use std::sync::{Arc, RwLock};

use chrono::{Local, Datelike, Timelike};
use governor::{Quota, RateLimiter};

/// A bandwidth schedule entry — limits bandwidth during a specific time window.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct BandwidthSchedule {
    /// Human-readable name (e.g., "Working hours")
    pub name: String,
    /// Start time in "HH:MM" format (24h)
    pub start_time: String,
    /// End time in "HH:MM" format (24h)
    pub end_time: String,
    /// Active days: 0=Mon, 1=Tue, ..., 6=Sun
    pub days: Vec<u8>,
    /// Max bandwidth in MB/s during this window
    pub max_bandwidth_mbps: u32,
}

impl BandwidthSchedule {
    fn parse_time(t: &str) -> Option<(u32, u32)> {
        let parts: Vec<&str> = t.split(':').collect();
        if parts.len() != 2 { return None; }
        let h = parts[0].parse::<u32>().ok()?;
        let m = parts[1].parse::<u32>().ok()?;
        Some((h, m))
    }

    /// Check if this schedule is active right now.
    fn is_active_now(&self) -> bool {
        let now = Local::now();
        // chrono: Mon=0 .. Sun=6 (weekday().num_days_from_monday())
        let today = now.weekday().num_days_from_monday() as u8;
        if !self.days.contains(&today) {
            return false;
        }

        let (sh, sm) = match Self::parse_time(&self.start_time) {
            Some(t) => t,
            None => return false,
        };
        let (eh, em) = match Self::parse_time(&self.end_time) {
            Some(t) => t,
            None => return false,
        };

        let now_mins = now.hour() * 60 + now.minute();
        let start_mins = sh * 60 + sm;
        let end_mins = eh * 60 + em;

        if start_mins <= end_mins {
            // Normal range: e.g., 09:00 - 18:00
            now_mins >= start_mins && now_mins < end_mins
        } else {
            // Overnight range: e.g., 22:00 - 06:00
            now_mins >= start_mins || now_mins < end_mins
        }
    }
}

/// Configuration for the bandwidth throttle.
#[derive(Debug, Clone)]
pub struct ThrottleConfig {
    pub global_max_mbps: Option<u32>,
    pub schedules: Vec<BandwidthSchedule>,
}

type DirectLimiter = RateLimiter<
    governor::state::NotKeyed,
    governor::state::InMemoryState,
    governor::clock::DefaultClock,
>;

/// A bandwidth throttle that limits bytes per second, with support for
/// time-based schedules.
pub struct BandwidthThrottle {
    config: RwLock<ThrottleConfig>,
    /// Cache: limiter keyed by bytes-per-second value
    limiter_cache: RwLock<Option<(u64, Arc<DirectLimiter>)>>,
}

impl BandwidthThrottle {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(ThrottleConfig {
                global_max_mbps: None,
                schedules: vec![],
            }),
            limiter_cache: RwLock::new(None),
        }
    }

    /// Update the throttle configuration (called when settings change).
    pub fn update_config(&self, global_max_mbps: Option<u32>, schedules: Vec<BandwidthSchedule>) {
        let mut config = self.config.write().unwrap();
        config.global_max_mbps = global_max_mbps;
        config.schedules = schedules;
        // Invalidate limiter cache
        *self.limiter_cache.write().unwrap() = None;
    }

    /// Get the effective bandwidth limit in bytes/sec for right now.
    /// Returns None if unlimited.
    fn effective_bps(&self) -> Option<u64> {
        let config = self.config.read().unwrap();

        // Check schedules first — most specific wins
        for schedule in &config.schedules {
            if schedule.is_active_now() {
                let mbps = schedule.max_bandwidth_mbps;
                if mbps == 0 { return None; } // 0 = unlimited
                return Some(mbps as u64 * 1024 * 1024);
            }
        }

        // Fall back to global limit
        match config.global_max_mbps {
            Some(0) | None => None,
            Some(mbps) => Some(mbps as u64 * 1024 * 1024),
        }
    }

    fn get_or_create_limiter(&self, bps: u64) -> Arc<DirectLimiter> {
        // Check cache
        {
            let cache = self.limiter_cache.read().unwrap();
            if let Some((cached_bps, ref limiter)) = *cache {
                if cached_bps == bps {
                    return Arc::clone(limiter);
                }
            }
        }

        // Create new limiter
        let bps_clamped = bps.max(1024); // Minimum 1 KB/s
        let per_sec = (bps_clamped as u32).max(1);
        let quota = Quota::per_second(NonZeroU32::new(per_sec).unwrap());
        let limiter = Arc::new(RateLimiter::direct(quota));

        // Cache it
        *self.limiter_cache.write().unwrap() = Some((bps, Arc::clone(&limiter)));
        limiter
    }

    /// Wait until the given number of bytes can be transferred.
    /// This checks the current schedule on each call.
    pub async fn acquire(&self, bytes: u64) {
        let bps = match self.effective_bps() {
            Some(bps) => bps,
            None => return, // Unlimited
        };

        let limiter = self.get_or_create_limiter(bps);

        // Acquire in chunks of the burst size to avoid blocking too long
        let chunk = 8192u64;
        let permits = bytes / chunk;
        for _ in 0..permits {
            limiter.until_ready().await;
        }
    }
}
