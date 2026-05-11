//! Sliding-window speed / ETA tracker for upload and download progress
//! callbacks.
//!
//! The callbacks fire frequently (one per multipart chunk or per
//! download buffer flush). To avoid jittery numbers in the UI we keep
//! only the last few seconds of `(timestamp, cumulative_bytes)` samples
//! and compute the slope across that window. ETA falls out from the
//! current speed and the bytes still to transfer.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Width of the smoothing window. 5 s is reactive enough to feel live
/// without surfacing every TCP burst.
const WINDOW: Duration = Duration::from_secs(5);

pub struct SpeedTracker {
    samples: Mutex<VecDeque<(Instant, u64)>>,
}

impl SpeedTracker {
    pub fn new() -> Self {
        Self {
            samples: Mutex::new(VecDeque::new()),
        }
    }

    /// Record a new cumulative byte count and return
    /// `(speed_bps, eta_secs)`. Both are `0` until at least two
    /// samples are available, or when `total == 0` for the ETA.
    pub fn update(&self, transferred: u64, total: u64) -> (i64, i64) {
        let now = Instant::now();

        let mut samples = self.samples.lock().expect("speed tracker poisoned");
        samples.push_back((now, transferred));
        while let Some(&(ts, _)) = samples.front() {
            if now.duration_since(ts) > WINDOW {
                samples.pop_front();
            } else {
                break;
            }
        }

        if samples.len() < 2 {
            return (0, 0);
        }

        let (t0, b0) = *samples.front().unwrap();
        let (t1, b1) = *samples.back().unwrap();
        let secs = t1.duration_since(t0).as_secs_f64();
        if secs <= 0.0 || b1 < b0 {
            return (0, 0);
        }

        let speed_bps = ((b1 - b0) as f64 / secs) as i64;
        let eta_secs = if speed_bps > 0 && total > transferred {
            ((total - transferred) as f64 / speed_bps as f64).round() as i64
        } else {
            0
        };
        (speed_bps, eta_secs)
    }
}

impl Default for SpeedTracker {
    fn default() -> Self {
        Self::new()
    }
}
