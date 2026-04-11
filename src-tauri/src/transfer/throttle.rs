use std::num::NonZeroU32;

use governor::{Quota, RateLimiter};

/// A bandwidth throttle that limits bytes per second.
pub struct BandwidthThrottle {
    limiter: Option<RateLimiter<governor::state::NotKeyed, governor::state::InMemoryState, governor::clock::DefaultClock>>,
}

impl BandwidthThrottle {
    /// Create a new throttle. `max_bytes_per_sec` of None means unlimited.
    pub fn new(max_bytes_per_sec: Option<u64>) -> Self {
        let limiter = max_bytes_per_sec.map(|bps| {
            let bps = bps.max(1024); // Minimum 1 KB/s
            let quota = Quota::per_second(NonZeroU32::new(bps as u32).unwrap());
            RateLimiter::direct(quota)
        });

        Self { limiter }
    }

    /// Wait until the given number of bytes can be transferred.
    pub async fn acquire(&self, bytes: u64) {
        if let Some(limiter) = &self.limiter {
            // Acquire permits for the number of bytes
            // We acquire in chunks to avoid issues with large values
            let chunk_size = 8192u64;
            let chunks = bytes / chunk_size;
            for _ in 0..chunks {
                limiter.until_ready().await;
            }
        }
    }

    /// Check if throttling is active.
    pub fn is_active(&self) -> bool {
        self.limiter.is_some()
    }
}
