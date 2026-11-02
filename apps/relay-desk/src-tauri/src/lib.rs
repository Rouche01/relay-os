use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayHttpResult {
  status: u16,
  body: String,
}

#[tauri::command]
async fn gateway_http(
  base_url: String,
  token: String,
  method: String,
  path: String,
  body_json: Option<String>,
) -> Result<GatewayHttpResult, String> {
  let base = base_url.trim_end_matches('/');
  let path = if path.starts_with('/') {
    path
  } else {
    format!("/{path}")
  };
  let url = format!("{base}{path}");

  // Spec/app runs (esp. fanout + HITL) can exceed 30s; keep a generous ceiling.
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(300))
    .build()
    .map_err(|e| e.to_string())?;

  let method = method
    .parse::<reqwest::Method>()
    .map_err(|e| format!("bad method: {e}"))?;

  let mut req = client
    .request(method, &url)
    .header("Authorization", format!("Bearer {token}"));

  if let Some(body) = body_json {
    req = req
      .header("Content-Type", "application/json")
      .body(body);
  }

  let res = req.send().await.map_err(|e| e.to_string())?;
  let status = res.status().as_u16();
  let body = res.text().await.map_err(|e| e.to_string())?;
  Ok(GatewayHttpResult { status, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![gateway_http])
    .run(tauri::generate_context!())
    .expect("error while running Relay Desk");
}
