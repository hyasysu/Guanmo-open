use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

pub const CONFIG_REQUESTS_PER_MINUTE: usize = 120;
pub const APP_REQUESTS_PER_MINUTE: usize = 240;
pub const SESSION_REQUESTS: usize = 10_000;
pub const SESSION_RESPONSE_BYTES: usize = 512 * 1024 * 1024;
const WINDOW: Duration = Duration::from_secs(60);

// Process-session counters: cancellation, failure and configuration changes never refund usage.
#[derive(Default)]
pub struct ApiUsage {
    recent: VecDeque<Instant>,
    configurations: HashMap<String, VecDeque<Instant>>,
    requests: usize,
    response_bytes: usize,
}

impl ApiUsage {
    pub fn ensure_output_capacity(&self) -> Result<(), &'static str> {
        if self.response_bytes >= SESSION_RESPONSE_BYTES {
            Err("SESSION_LIMIT_EXCEEDED")
        } else {
            Ok(())
        }
    }

    pub fn admit(&mut self, configuration: &str, now: Instant) -> Result<(), &'static str> {
        if self.requests >= SESSION_REQUESTS || self.response_bytes >= SESSION_RESPONSE_BYTES {
            return Err("SESSION_LIMIT_EXCEEDED");
        }
        let prune = |entries: &mut VecDeque<Instant>| {
            while entries
                .front()
                .is_some_and(|time| now.duration_since(*time) >= WINDOW)
            {
                entries.pop_front();
            }
        };
        prune(&mut self.recent);
        self.configurations.retain(|_, entries| {
            prune(entries);
            !entries.is_empty()
        });
        if self.recent.len() >= APP_REQUESTS_PER_MINUTE
            || self
                .configurations
                .get(configuration)
                .is_some_and(|entries| entries.len() >= CONFIG_REQUESTS_PER_MINUTE)
        {
            return Err("RATE_LIMIT_EXCEEDED");
        }
        self.recent.push_back(now);
        self.configurations
            .entry(configuration.to_owned())
            .or_default()
            .push_back(now);
        self.requests += 1;
        Ok(())
    }

    pub fn receive(&mut self, bytes: usize) -> Result<(), &'static str> {
        self.response_bytes = self.response_bytes.saturating_add(bytes);
        if self.response_bytes > SESSION_RESPONSE_BYTES {
            Err("SESSION_LIMIT_EXCEEDED")
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_rate_window_expires_without_refunding_session_usage() {
        let mut usage = ApiUsage::default();
        let now = Instant::now();
        for _ in 0..CONFIG_REQUESTS_PER_MINUTE {
            usage.admit("a", now).unwrap();
        }
        assert_eq!(usage.admit("a", now), Err("RATE_LIMIT_EXCEEDED"));
        usage.admit("b", now).unwrap();
        usage.admit("a", now + WINDOW).unwrap();
        assert_eq!(usage.requests, CONFIG_REQUESTS_PER_MINUTE + 2);
        assert_eq!(usage.configurations.len(), 1);
    }

    #[test]
    fn changing_configuration_cannot_bypass_application_limits() {
        let mut usage = ApiUsage::default();
        let now = Instant::now();
        for i in 0..APP_REQUESTS_PER_MINUTE {
            usage.admit(&i.to_string(), now).unwrap();
        }
        assert_eq!(usage.admit("new", now), Err("RATE_LIMIT_EXCEEDED"));
        for i in APP_REQUESTS_PER_MINUTE..SESSION_REQUESTS {
            usage.admit("a", now + WINDOW * (i as u32 + 1)).unwrap();
        }
        assert_eq!(
            usage.admit("new", now + WINDOW * 20_000),
            Err("SESSION_LIMIT_EXCEEDED")
        );
    }

    #[test]
    fn all_response_bytes_count_even_for_failed_or_cancelled_requests() {
        let mut usage = ApiUsage::default();
        usage.receive(SESSION_RESPONSE_BYTES - 1).unwrap();
        usage.receive(1).unwrap();
        assert_eq!(
            usage.admit("new", Instant::now()),
            Err("SESSION_LIMIT_EXCEEDED")
        );
        assert_eq!(usage.receive(1), Err("SESSION_LIMIT_EXCEEDED"));
        assert_eq!(usage.receive(usize::MAX), Err("SESSION_LIMIT_EXCEEDED"));
    }

    #[test]
    fn normal_agent_and_embedding_batches_fit_the_limits() {
        let mut usage = ApiUsage::default();
        let now = Instant::now();
        for _ in 0..10 {
            usage.admit("chat", now).unwrap();
        }
        for _ in 0..101 {
            usage.admit("embedding", now).unwrap();
        }
        for _ in 0..5 {
            usage.admit("search", now).unwrap();
        }
        usage.receive(16 * 1024 * 1024).unwrap();
    }

    #[test]
    fn concurrent_admission_is_atomic_under_the_application_lock() {
        let usage = std::sync::Arc::new(std::sync::Mutex::new(ApiUsage::default()));
        let now = Instant::now();
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let usage = usage.clone();
                std::thread::spawn(move || {
                    (0..30)
                        .filter(|_| usage.lock().unwrap().admit("a", now).is_ok())
                        .count()
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .sum::<usize>(),
            CONFIG_REQUESTS_PER_MINUTE
        );
        let mut usage = usage.lock().unwrap();
        usage.ensure_output_capacity().unwrap();
        usage.receive(SESSION_RESPONSE_BYTES).unwrap();
        assert_eq!(
            usage.ensure_output_capacity(),
            Err("SESSION_LIMIT_EXCEEDED")
        );
    }
}
