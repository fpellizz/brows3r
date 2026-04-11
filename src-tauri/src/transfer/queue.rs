use std::collections::VecDeque;

use tokio::sync::{Mutex, Semaphore};

use crate::models::transfer::{TransferItem, TransferStatus};

/// Central transfer queue managing upload and download tasks.
pub struct TransferQueue {
    items: Mutex<VecDeque<TransferItem>>,
    concurrency: Semaphore,
    max_concurrent: u32,
}

impl TransferQueue {
    pub fn new(max_concurrent: u32) -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            concurrency: Semaphore::new(max_concurrent as usize),
            max_concurrent,
        }
    }

    /// Add a transfer to the queue.
    pub async fn enqueue(&self, item: TransferItem) {
        let mut items = self.items.lock().await;
        items.push_back(item);
    }

    /// Get a snapshot of all transfers.
    pub async fn list(&self) -> Vec<TransferItem> {
        let items = self.items.lock().await;
        items.iter().cloned().collect()
    }

    /// Update the status of a transfer by ID.
    pub async fn update_status(&self, id: &str, status: TransferStatus) {
        let mut items = self.items.lock().await;
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.status = status;
        }
    }

    /// Update transfer progress.
    pub async fn update_progress(
        &self,
        id: &str,
        transferred_bytes: i64,
        speed_bps: i64,
        eta_secs: i64,
    ) {
        let mut items = self.items.lock().await;
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.transferred_bytes = transferred_bytes;
            item.speed_bps = Some(speed_bps);
            item.eta_secs = Some(eta_secs);
        }
    }

    /// Mark a transfer as completed.
    pub async fn complete(&self, id: &str) {
        let mut items = self.items.lock().await;
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.status = TransferStatus::Completed;
            item.transferred_bytes = item.total_bytes;
            item.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    /// Mark a transfer as failed.
    pub async fn fail(&self, id: &str, error: String) {
        let mut items = self.items.lock().await;
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.status = TransferStatus::Failed;
            item.error = Some(error);
        }
    }

    /// Remove completed/cancelled/failed transfers from the queue.
    pub async fn clear_finished(&self) {
        let mut items = self.items.lock().await;
        items.retain(|item| {
            !matches!(
                item.status,
                TransferStatus::Completed | TransferStatus::Cancelled | TransferStatus::Failed
            )
        });
    }

    /// Acquire a concurrency permit. Returns when a slot is available.
    pub async fn acquire_permit(&self) -> tokio::sync::SemaphorePermit<'_> {
        self.concurrency
            .acquire()
            .await
            .expect("Semaphore closed unexpectedly")
    }
}
