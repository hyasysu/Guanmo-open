use serde::Deserialize;

const REMINDER_GROUP: &str = "guanmo-reminder";
const APP_USER_MODEL_ID: &str = "com.guanmo.app";
const WINDOWS_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleReadingReminderNotificationInput {
    id: i32,
    title: String,
    body: String,
    due_at_utc: i64,
}

fn validate_id(id: i32) -> Result<(), String> {
    if id <= 0 {
        return Err("notification_id_invalid".into());
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize, error: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_chars
        || trimmed
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(error.into());
    }
    Ok(())
}

fn windows_delivery_time(due_at_utc: i64, now_utc: i64) -> Result<i64, String> {
    if due_at_utc <= now_utc {
        return Err("reminder_due_time_invalid".into());
    }
    due_at_utc
        .checked_add(WINDOWS_EPOCH_OFFSET_MS)
        .and_then(|milliseconds| milliseconds.checked_mul(10_000))
        .ok_or_else(|| "reminder_due_time_overflow".into())
}

fn escape_xml_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn reminder_xml(title: &str, body: &str) -> String {
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escape_xml_text(title),
        escape_xml_text(body),
    )
}

fn belongs_to_reminder_group(group: &str, id: &str, expected_id: Option<i32>) -> bool {
    if group != REMINDER_GROUP {
        return false;
    }
    let Ok(parsed_id) = id.parse::<i32>() else {
        return false;
    };
    parsed_id > 0 && expected_id.is_none_or(|expected| expected == parsed_id)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Foundation::DateTime,
        UI::Notifications::{ScheduledToastNotification, ToastNotificationManager, ToastNotifier},
    };

    fn now_utc_millis() -> Result<i64, String> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "system_time_invalid")?
            .as_millis();
        i64::try_from(millis).map_err(|_| "system_time_overflow".into())
    }

    fn notifier(error_code: &str) -> Result<ToastNotifier, String> {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_USER_MODEL_ID))
            .map_err(|_| error_code.into())
    }

    fn scheduled_notifications(
        notifier: &ToastNotifier,
        error_code: &str,
    ) -> Result<Vec<ScheduledToastNotification>, String> {
        let notifications = notifier
            .GetScheduledToastNotifications()
            .map_err(|_| error_code.to_string())?;
        let size = notifications.Size().map_err(|_| error_code.to_string())?;
        (0..size)
            .map(|index| {
                notifications
                    .GetAt(index)
                    .map_err(|_| error_code.to_string())
            })
            .collect()
    }

    fn notification_identity(
        notification: &ScheduledToastNotification,
        error_code: &str,
    ) -> Result<(String, String), String> {
        let group = notification
            .Group()
            .map_err(|_| error_code.to_string())?
            .to_string();
        let id = notification
            .Id()
            .map_err(|_| error_code.to_string())?
            .to_string();
        Ok((group, id))
    }

    pub fn schedule(input: ScheduleReadingReminderNotificationInput) -> Result<(), String> {
        validate_id(input.id)?;
        validate_text(&input.title, 200, "notification_title_invalid")?;
        validate_text(&input.body, 2_000, "notification_body_invalid")?;
        let delivery_time = windows_delivery_time(input.due_at_utc, now_utc_millis()?)?;
        let notifier = notifier("notification_schedule_failed")?;

        for notification in scheduled_notifications(&notifier, "notification_schedule_failed")? {
            let (group, id) = notification_identity(&notification, "notification_schedule_failed")?;
            if belongs_to_reminder_group(&group, &id, Some(input.id)) {
                notifier
                    .RemoveFromSchedule(&notification)
                    .map_err(|_| "notification_schedule_failed".to_string())?;
            }
        }

        let document = XmlDocument::new().map_err(|_| "notification_schedule_failed")?;
        document
            .LoadXml(&HSTRING::from(reminder_xml(&input.title, &input.body)))
            .map_err(|_| "notification_schedule_failed".to_string())?;
        let notification = ScheduledToastNotification::CreateScheduledToastNotification(
            &document,
            DateTime {
                UniversalTime: delivery_time,
            },
        )
        .map_err(|_| "notification_schedule_failed".to_string())?;
        let id = HSTRING::from(input.id.to_string());
        notification
            .SetId(&id)
            .map_err(|_| "notification_schedule_failed".to_string())?;
        notification
            .SetTag(&id)
            .map_err(|_| "notification_schedule_failed".to_string())?;
        notification
            .SetGroup(&HSTRING::from(REMINDER_GROUP))
            .map_err(|_| "notification_schedule_failed".to_string())?;
        notifier
            .AddToSchedule(&notification)
            .map_err(|_| "notification_schedule_failed".to_string())
    }

    pub fn list() -> Result<Vec<i32>, String> {
        let notifier = notifier("notification_list_failed")?;
        let mut ids = Vec::new();
        for notification in scheduled_notifications(&notifier, "notification_list_failed")? {
            let (group, id) = notification_identity(&notification, "notification_list_failed")?;
            if belongs_to_reminder_group(&group, &id, None) {
                ids.push(id.parse().map_err(|_| "notification_list_failed")?);
            }
        }
        ids.sort_unstable();
        ids.dedup();
        Ok(ids)
    }

    pub fn cancel(id: i32) -> Result<(), String> {
        validate_id(id)?;
        let notifier = notifier("notification_cancel_failed")?;
        for notification in scheduled_notifications(&notifier, "notification_cancel_failed")? {
            let (group, notification_id) =
                notification_identity(&notification, "notification_cancel_failed")?;
            if belongs_to_reminder_group(&group, &notification_id, Some(id)) {
                notifier
                    .RemoveFromSchedule(&notification)
                    .map_err(|_| "notification_cancel_failed".to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ScheduleReadingReminderNotificationInput;

    pub fn schedule(_: ScheduleReadingReminderNotificationInput) -> Result<(), String> {
        Err("unsupported_platform".into())
    }

    pub fn list() -> Result<Vec<i32>, String> {
        Err("unsupported_platform".into())
    }

    pub fn cancel(_: i32) -> Result<(), String> {
        Err("unsupported_platform".into())
    }
}

#[tauri::command]
pub fn schedule_reading_reminder_notification(
    input: ScheduleReadingReminderNotificationInput,
) -> Result<(), String> {
    platform::schedule(input)
}

#[tauri::command]
pub fn list_pending_reading_reminder_notification_ids() -> Result<Vec<i32>, String> {
    platform::list()
}

#[tauri::command]
pub fn cancel_reading_reminder_notification(id: i32) -> Result<(), String> {
    platform::cancel(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_unix_milliseconds_to_windows_ticks() {
        assert_eq!(
            windows_delivery_time(1_700_000_000_000, 1_699_999_999_999),
            Ok(133_444_736_000_000_000)
        );
        assert_eq!(
            windows_delivery_time(1_700_000_000_000, 1_700_000_000_000),
            Err("reminder_due_time_invalid".into())
        );
        assert_eq!(
            windows_delivery_time(i64::MAX, 0),
            Err("reminder_due_time_overflow".into())
        );
    }

    #[test]
    fn escapes_untrusted_notification_text() {
        assert_eq!(
            reminder_xml("A < B & C", "</text><text>injected"),
            "<toast><visual><binding template=\"ToastGeneric\"><text>A &lt; B &amp; C</text><text>&lt;/text&gt;&lt;text&gt;injected</text></binding></visual></toast>"
        );
    }

    #[test]
    fn validates_ids_and_bounded_nonempty_text() {
        assert_eq!(validate_id(0), Err("notification_id_invalid".into()));
        assert_eq!(validate_text("  ", 200, "invalid"), Err("invalid".into()));
        assert!(validate_text("提醒", 200, "invalid").is_ok());
        assert!(validate_text("a\u{0000}b", 200, "invalid").is_err());
    }

    #[test]
    fn only_matches_positive_ids_in_the_fixed_group() {
        assert!(belongs_to_reminder_group(REMINDER_GROUP, "42", None));
        assert!(belongs_to_reminder_group(REMINDER_GROUP, "42", Some(42)));
        assert!(!belongs_to_reminder_group("other", "42", None));
        assert!(!belongs_to_reminder_group(REMINDER_GROUP, "-1", None));
        assert!(!belongs_to_reminder_group(REMINDER_GROUP, "42", Some(7)));
    }
}
