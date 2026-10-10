use discord_rich_presence::activity::{Activity, ActivityType, Assets, StatusDisplayType};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DISCORD_CLIENT_ID: &str = "1523406858134487071";
/// Discord Listening: `state` = song (shown in «Слушает …»), `details` = artist line.
const IDLE_SONG: &str = "Render";
const IDLE_ARTIST: &str = "SoundCloud";
/// Upload in Discord Developer Portal → Rich Presence → Art Assets with this key.
const APP_LOGO_ASSET: &str = "render";

const DISCORD_PRESENCE_EVENT: &str = "discord-presence-update";

#[derive(Clone, Deserialize)]
struct KeybindEntry {
    action: String,
    shortcut: String,
}

#[derive(Deserialize)]
struct PresencePayload {
    title: String,
    artist: String,
    cover: String,
    #[serde(rename = "isPlaying")]
    is_playing: bool,
    #[serde(default)]
    idle: bool,
}

struct DiscordRpcState(Mutex<Option<DiscordIpcClient>>);

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn external_image_key(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http") {
        return None;
    }
    let digest = md5::compute(trimmed.as_bytes());
    let hash = format!("{digest:x}");
    let short = hash.chars().take(32).collect::<String>();
    Some(format!("mp:external/{short}/{}", percent_encode(trimmed)))
}

fn connect_discord() -> Result<DiscordIpcClient, String> {
    let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
    client
        .connect()
        .map_err(|error| format!("discord connect failed: {error}"))?;
    Ok(client)
}

fn reset_client(state: &DiscordRpcState) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }
}

fn with_client<F>(state: &DiscordRpcState, action: F) -> Result<(), String>
where
    F: Fn(&mut DiscordIpcClient) -> Result<(), String>,
{
    let mut guard = state.0.lock().map_err(|_| "discord lock poisoned".to_string())?;

    if guard.is_none() {
        *guard = Some(connect_discord()?);
    }

    let client = guard.as_mut().ok_or_else(|| "discord unavailable".to_string())?;

    match action(client) {
        Ok(()) => Ok(()),
        Err(error) => {
            *guard = None;
            Err(error)
        }
    }
}

fn push_activity(client: &mut DiscordIpcClient, activity: Activity<'_>) -> Result<(), String> {
    client
        .set_activity(activity)
        .map_err(|error| error.to_string())
}

fn listening_activity<'a>(
    song: &'a str,
    artist_line: &'a str,
    image_key: Option<&'a str>,
) -> Activity<'a> {
    let mut activity = Activity::new()
        .activity_type(ActivityType::Listening)
        .status_display_type(StatusDisplayType::State)
        .state(song)
        .details(artist_line);

    if let Some(key) = image_key {
        activity = activity.assets(
            Assets::new()
                .large_image(key)
                .large_text(song),
        );
    }

    activity
}

fn idle_activity() -> Activity<'static> {
    listening_activity(IDLE_SONG, IDLE_ARTIST, Some(APP_LOGO_ASSET))
}

fn set_idle_presence(state: &DiscordRpcState) -> Result<(), String> {
    with_client(state, |client| {
        let activity = idle_activity();
        if let Err(first_error) = push_activity(client, activity) {
            let fallback = listening_activity(IDLE_SONG, IDLE_ARTIST, None);
            push_activity(client, fallback)
                .map_err(|retry_error| format!("{first_error}; retry: {retry_error}"))?;
        }
        Ok(())
    })
}

fn set_track_presence(state: &DiscordRpcState, payload: &PresencePayload) -> Result<(), String> {
    let song = payload.title.trim();
    if song.is_empty() || payload.idle {
        return set_idle_presence(state);
    }

    let artist = if payload.artist.trim().is_empty() {
        "SoundCloud".to_string()
    } else {
        payload.artist.trim().to_string()
    };

    let artist_line = if payload.is_playing {
        artist
    } else {
        format!("{artist} · Paused")
    };

    with_client(state, |client| {
        let image_key = external_image_key(&payload.cover);
        let activity = listening_activity(song, &artist_line, image_key.as_deref());

        if let Err(first_error) = push_activity(client, activity) {
            if image_key.is_some() {
                let fallback = listening_activity(song, &artist_line, None);
                push_activity(client, fallback)
                    .map_err(|retry_error| format!("{first_error}; retry: {retry_error}"))?;
            } else {
                return Err(first_error);
            }
        }

        Ok(())
    })
}

fn apply_presence_payload(state: &DiscordRpcState, payload: &PresencePayload) -> Result<(), String> {
    set_track_presence(state, payload)
}

#[tauri::command]
fn init_discord_presence(state: State<DiscordRpcState>) -> Result<(), String> {
    set_idle_presence(&state)
}

#[tauri::command]
fn update_discord_presence(
    state: State<DiscordRpcState>,
    payload: PresencePayload,
) -> Result<(), String> {
    apply_presence_payload(&state, &payload)
}

#[tauri::command]
fn clear_discord_presence(state: State<DiscordRpcState>) -> Result<(), String> {
    let result = with_client(&state, |client| {
        client
            .clear_activity()
            .map_err(|error| error.to_string())
    });

    if result.is_err() {
        reset_client(&state);
    }

    result
}

#[tauri::command]
fn sync_global_keybinds(app: AppHandle, entries: Vec<KeybindEntry>) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|error| error.to_string())?;

    let mut registered = 0usize;
    let mut errors = Vec::new();

    for entry in entries {
        let action = entry.action.clone();
        let shortcut: Shortcut = match entry.shortcut.parse() {
            Ok(value) => value,
            Err(error) => {
                errors.push(format!("{}: {error}", entry.shortcut));
                continue;
            }
        };

        match shortcuts.on_shortcut(shortcut, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit("global-keybind", action.clone());
            }
        }) {
            Ok(()) => registered += 1,
            Err(error) => errors.push(format!("{}: {error}", entry.shortcut)),
        }
    }

    if registered == 0 && !errors.is_empty() {
        return Err(format!("No global keybinds registered: {}", errors.join("; ")));
    }

    if !errors.is_empty() {
        eprintln!("[keybinds] partial sync: {}", errors.join("; "));
    }

    Ok(())
}

fn emit_app_active(app: &AppHandle, active: bool) {
    let _ = app.emit("app-active", active);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(DiscordRpcState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            app.listen(DISCORD_PRESENCE_EVENT, move |event| {
                let payload = match serde_json::from_str::<PresencePayload>(event.payload()) {
                    Ok(payload) => payload,
                    Err(error) => {
                        eprintln!("[discord] bad event payload: {error}");
                        return;
                    }
                };

                if let Some(state) = handle.try_state::<DiscordRpcState>() {
                    if let Err(error) = apply_presence_payload(&state, &payload) {
                        eprintln!("[discord] event presence failed: {error}");
                    }
                }
            });

            let state = app.state::<DiscordRpcState>();
            if let Err(error) = set_idle_presence(&state) {
                eprintln!("[discord] startup presence failed: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_global_keybinds,
            init_discord_presence,
            update_discord_presence,
            clear_discord_presence
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    match event {
                        tauri::WindowEvent::Focused(focused) => {
                            emit_app_active(app_handle, focused);
                        }
                        tauri::WindowEvent::Resized(_) => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Ok(minimized) = window.is_minimized() {
                                    if minimized {
                                        emit_app_active(app_handle, false);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                tauri::RunEvent::Exit => {
                    if let Some(state) = app_handle.try_state::<DiscordRpcState>() {
                        let _ = clear_discord_presence(state);
                    }
                }
                _ => {}
            }
        });
}
