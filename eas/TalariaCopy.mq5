//+------------------------------------------------------------------+
//|                                                   TalariaCopy.mq5 |
//|                         Noble Trading - Talaria Copy               |
//|                                                                  |
//| Copies qualified Talaria signals into this trading account.      |
//| Attach once on any chart - all plan symbols are handled.         |
//+------------------------------------------------------------------+
#property copyright "Noble Trading"
#property link      "https://nobletrading.app"
#property version   "1.00"
#property description "Talaria Copy - copy qualified signals to this account"
#property description "Attach once on any chart. Covers every symbol in your plan."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>
#include "TalariaRealtime.mqh"

//--- enums
enum ENUM_OTC_MODE
  {
   OTC_MODE_SHADOW  = 0,  // Shadow - log only, do not place orders
   OTC_MODE_CONFIRM = 1,  // Confirm - chart BUY/SELL buttons on signal
   OTC_MODE_LIVE    = 2   // Live - place orders automatically
  };

enum ENUM_OTC_TRANSPORT
  {
   OTC_TRANSPORT_REST_POLL = 0, // REST poll (fallback)
   OTC_TRANSPORT_WS_PUSH   = 1  // Supabase Realtime WebSocket (push)
  };

//+------------------------------------------------------------------+
//| Inputs                                                           |
//+------------------------------------------------------------------+
input group           "Trading"
input bool            EnableTrading        = false;        // Place orders (No = watch only)
input ENUM_OTC_MODE   Mode                 = OTC_MODE_CONFIRM; // Shadow / Confirm (chart BUY-SELL) / Live
input double          RiskPercentPerTrade  = 0.5;          // Risk % of account equity per signal
input double          MaxLotsPerOrder      = 1.0;          // Maximum lots per order
input int             MaxOpenPositions     = 5;            // Maximum open positions
input int             SlippagePoints       = 20;           // Slippage (points)
input bool            MoveSLToBEAfterTP1   = false;        // Move stop to breakeven after first target (soon)
input int             MaxSignalAgeSec      = 1800;         // Ignore signals older than (seconds) — keep > PollIntervalSec
input int             ConfirmTimeoutSec    = 120;          // Confirm-mode BUY/SELL buttons expire (s)

input group           "Connection"
input string          EndpointURL          = "https://pcvscowltlrxzgxjurcr.supabase.co/functions/v1/talaria-copy"; // Signal service (preset)
input string          TokenFilePath        = "otc_token.txt"; // Claim token file (in MQL5\Files)
input string          StateFilePath        = "otc_state.csv"; // Progress file (auto-managed)
input ENUM_OTC_TRANSPORT TransportMode     = OTC_TRANSPORT_WS_PUSH; // Connection type (WS push, REST fallback)
input int             PollIntervalSec      = 600;          // Signal poll (s). Light sweep ~15min — do not use 2s (2026-09-29)
input int             HandshakeIntervalSec = 43200;        // Claim/subscription re-check (s) — default 12h
input int             HttpTimeoutMs        = 8000;         // Network timeout (ms)

input group           "Protection"
input long            MagicNumber          = 20260908;    // Magic number (keeps EA trades separate)
input string          SymbolMap            = "";           // Symbol overrides (optional: XAUUSD=XAUUSDm)
input int             RequoteRetries       = 3;            // Retry count if price moves
input int             RequoteDelayMs       = 400;          // Wait between retries (ms)

//+------------------------------------------------------------------+
//| Globals                                                          |
//+------------------------------------------------------------------+
CTrade         g_trade;
CPositionInfo  g_position;
CSymbolInfo    g_symbol_info;

string   g_token = "";
string   g_plan_slug = "";
string   g_plan_uuid = "";
string   g_sub_status = "";
bool     g_entitled = false;
bool     g_connected = false;
string   g_last_error = "";
string   g_map_from[];   // canonical â†' broker
string   g_map_to[];
string   g_plan_symbols[];
datetime g_last_poll = 0;
datetime g_last_handshake = 0;
   datetime g_entitled_until = 0; // period_end from handshake � entitlement TTL
bool     g_paused = false;
long     g_chart_id = 0;
// Option A - Supabase Realtime push (plugin parity)
string   g_rt_url = "";
string   g_rt_apikey = "";
string   g_rt_topic = "";
string   g_rt_vsn = "1.0.0";
CTalariaRealtimeSession g_rt;
// Confirm-mode pending signal (chart BUY/SELL) — 2026-09-29
bool     g_pend_active = false;
string   g_pend_uid = "";
string   g_pend_symbol = "";
string   g_pend_broker = "";
string   g_pend_side = "";
double   g_pend_entry = 0, g_pend_sl = 0, g_pend_tp = 0, g_pend_lots = 0;
datetime g_pend_until = 0;

#define OTC_COMMENT_PREFIX "OTC:"
#define OTC_MAX_STATE 500

//+------------------------------------------------------------------+
//| Minimal JSON helpers (string scan - no external deps)            |
//+------------------------------------------------------------------+
string JsonUnescape(const string s)
  {
   string out = s;
   StringReplace(out, "\\\"", "\"");
   StringReplace(out, "\\\\", "\\");
   StringReplace(out, "\\n", "\n");
   StringReplace(out, "\\r", "\r");
   StringReplace(out, "\\t", "\t");
   return out;
  }

bool JsonGetBool(const string json, const string key, bool &value)
  {
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return false;
   int colon = StringFind(json, ":", p);
   if(colon < 0) return false;
   int i = colon + 1;
   int n = StringLen(json);
   while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
      i++;
   if(i + 4 <= n && StringSubstr(json, i, 4) == "true")  { value = true;  return true; }
   if(i + 5 <= n && StringSubstr(json, i, 5) == "false") { value = false; return true; }
   return false;
  }

bool JsonGetString(const string json, const string key, string &value)
  {
   // Match "key" then ':' then a quoted string value.
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return false;
   int n = StringLen(json);
   int i = p + StringLen(pat);
   while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
      i++;
   if(i >= n || StringGetCharacter(json, i) != ':') return false;
   i++;
   while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
      i++;
   if(i >= n || StringGetCharacter(json, i) != '"') return false;
   int start = i + 1;
   int end = start;
   while(end < n)
     {
      ushort c = StringGetCharacter(json, end);
      if(c == '\\') { end += 2; continue; }
      if(c == '"') break;
      end++;
     }
   if(end >= n) return false;
   value = JsonUnescape(StringSubstr(json, start, end - start));
   return true;
  }

bool JsonGetNumber(const string json, const string key, double &value)
  {
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return false;
   int colon = StringFind(json, ":", p);
   if(colon < 0) return false;
   int i = colon + 1;
   int n = StringLen(json);
   while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
      i++;
   int start = i;
   while(i < n)
     {
      ushort c = StringGetCharacter(json, i);
      if((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')
        { i++; continue; }
      break;
     }
   if(i == start) return false;
   string num = StringSubstr(json, start, i - start);
   value = StringToDouble(num);
   return true;
  }

bool JsonIsNullField(const string json, const string key)
  {
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return false;
   int colon = StringFind(json, ":", p);
   if(colon < 0) return false;
   int i = colon + 1;
   int n = StringLen(json);
   while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
      i++;
   return (i + 4 <= n && StringSubstr(json, i, 4) == "null");
  }

// Extract the JSON array body for "key": [ ... ]
bool JsonGetArrayBody(const string json, const string key, string &body)
  {
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return false;
   int bracket = StringFind(json, "[", p);
   if(bracket < 0) return false;
   int depth = 0;
   int n = StringLen(json);
   for(int i = bracket; i < n; i++)
     {
      ushort c = StringGetCharacter(json, i);
      if(c == '[') depth++;
      else if(c == ']')
        {
         depth--;
         if(depth == 0)
           {
            body = StringSubstr(json, bracket + 1, i - bracket - 1);
            return true;
           }
        }
     }
   return false;
  }

// Split an array body of objects into object substrings
int JsonSplitObjects(const string body, string &objs[])
  {
   ArrayResize(objs, 0);
   int n = StringLen(body);
   int depth = 0;
   int start = -1;
   for(int i = 0; i < n; i++)
     {
      ushort c = StringGetCharacter(body, i);
      if(c == '{')
        {
         if(depth == 0) start = i;
         depth++;
        }
      else if(c == '}')
        {
         depth--;
         if(depth == 0 && start >= 0)
           {
            int sz = ArraySize(objs);
            ArrayResize(objs, sz + 1);
            objs[sz] = StringSubstr(body, start, i - start + 1);
            start = -1;
           }
        }
     }
   return ArraySize(objs);
  }

//+------------------------------------------------------------------+
//| Files                                                            |
//+------------------------------------------------------------------+
string ReadAllText(const string filename)
  {
   int h = FileOpen(filename, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      // try unicode
      h = FileOpen(filename, FILE_READ | FILE_TXT | FILE_UNICODE);
      if(h == INVALID_HANDLE) return "";
     }
   string content = "";
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      if(line == "" && FileIsEnding(h)) break;
      content += line;
     }
   FileClose(h);
   return content;
  }

bool WriteAllText(const string filename, const string content)
  {
   int h = FileOpen(filename, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   FileWriteString(h, content);
   FileClose(h);
   return true;
  }

string LoadToken()
  {
   string raw = ReadAllText(TokenFilePath);
   // accept first non-empty line; strip whitespace and optional quotes
   string token = raw;
   StringReplace(token, "\r", "");
   StringReplace(token, "\n", "");
   StringTrimLeft(token);
   StringTrimRight(token);
   if(StringLen(token) >= 2 && StringGetCharacter(token, 0) == '"' && StringGetCharacter(token, StringLen(token) - 1) == '"')
      token = StringSubstr(token, 1, StringLen(token) - 2);
   StringTrimLeft(token);
   StringTrimRight(token);
   return token;
  }

//--- processed UID state (one per line)
bool StateHas(const string uid)
  {
   int h = FileOpen(StateFilePath, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   bool found = false;
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      if(line == uid) { found = true; break; }
     }
   FileClose(h);
   return found;
  }

void StateAdd(const string uid)
  {
   if(StateHas(uid)) return;
   int h = FileOpen(StateFilePath, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE)
     {
      Print("Talaria Copy: state write failed: ", StateFilePath, " err=", GetLastError());
      return;
     }
   // Append via seek-to-end (FILE_APPEND is not portable across terminals).
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, uid + "\n");
   FileClose(h);
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
bool HttpPostJson(const string payload, string &response, string &err)
  {
   response = "";
   err = "";
   if(StringFind(EndpointURL, "https://") != 0)
     {
      err = "EndpointURL must be https://";
      return false;
     }
   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   char post[];
   char result[];
   string result_headers;
   int timeout = HttpTimeoutMs;
   // UTF-8 body including trailing NUL, then strip NUL for WebRequest
   StringToCharArray(payload, post, 0, -1, CP_UTF8);
   if(ArraySize(post) > 0 && post[ArraySize(post) - 1] == 0)
      ArrayResize(post, ArraySize(post) - 1);

   ResetLastError();
   int code = WebRequest("POST", EndpointURL, headers, timeout, post, result, result_headers);
   if(code == -1)
     {
      err = "WebRequest failed err=" + IntegerToString(GetLastError()) +
            " (allow URL in Toolsâ†'Optionsâ†'Expert Advisors)";
      return false;
     }
   if(code < 200 || code >= 300)
     {
      response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
      err = "HTTP " + IntegerToString(code) + " " + response;
      return false;
     }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return true;
  }

//+------------------------------------------------------------------+
//| Symbol map                                                       |
//+------------------------------------------------------------------+
void BuildSymbolMap()
  {
   ArrayResize(g_map_from, 0);
   ArrayResize(g_map_to, 0);
   if(StringLen(SymbolMap) == 0) return;
   string parts[];
   int n = StringSplit(SymbolMap, ',', parts);
   for(int i = 0; i < n; i++)
     {
      string kv[];
      if(StringSplit(parts[i], '=', kv) != 2) continue;
      string k = kv[0], v = kv[1];
      StringTrimLeft(k); StringTrimRight(k);
      StringTrimLeft(v); StringTrimRight(v);
      if(StringLen(k) == 0 || StringLen(v) == 0) continue;
      int sz = ArraySize(g_map_from);
      ArrayResize(g_map_from, sz + 1);
      ArrayResize(g_map_to, sz + 1);
      g_map_from[sz] = k;
      g_map_to[sz] = v;
     }
  }

string MapSymbol(const string canonical)
  {
   for(int i = 0; i < ArraySize(g_map_from); i++)
      if(g_map_from[i] == canonical) return g_map_to[i];

   // exact
   if(SymbolSelect(canonical, true)) return canonical;
   // common broker suffixes (PlexyTrade / raw / mini)
   string suffixes[] = {"", "m", ".m", "-m", "pro", ".pro", "raw", ".raw", "a", ".a", "i", ".i"};
   for(int s = 0; s < ArraySize(suffixes); s++)
     {
      string cand = canonical + suffixes[s];
      if(SymbolSelect(cand, true)) return cand;
     }
   // case-insensitive prefix scan over Market Watch
   string want = canonical;
   StringToUpper(want);
   for(int i = SymbolsTotal(true) - 1; i >= 0; i--)
     {
      string name = SymbolName(i, true);
      string upper = name;
      StringToUpper(upper);
      if(StringFind(upper, want) == 0 && StringLen(name) >= StringLen(canonical))
         return name;
     }
   return "";
  }

//+------------------------------------------------------------------+
//| Lot sizing (local, from EA inputs)                               |
//+------------------------------------------------------------------+
double NormalizeLots(const string symbol, double lots_raw, double max_lots)
  {
   double step  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double vmin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   if(vmin <= 0) vmin = step;
   if(vmax <= 0) vmax = 100.0;

   double cap = MathMin(vmax, MathMax(max_lots, vmin));
   double lots = MathFloor(lots_raw / step) * step;
   if(lots < vmin)
     {
      // cannot meet risk - skip rather than oversize
      return 0.0;
     }
   if(lots > cap) lots = MathFloor(cap / step) * step;
   return NormalizeDouble(lots, 2);
  }

double ComputeLots(const string broker_symbol, const string side,
                   double entry_price, double sl_price)
  {
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double risk_amount = equity * RiskPercentPerTrade / 100.0;
   if(risk_amount <= 0 || entry_price <= 0 || sl_price <= 0) return 0.0;

   double point = SymbolInfoDouble(broker_symbol, SYMBOL_POINT);
   if(point <= 0) return 0.0;

   double sl_dist = MathAbs(entry_price - sl_price);
   double sl_points = sl_dist / point;
   if(sl_points <= 0) return 0.0;

   double tick_value = SymbolInfoDouble(broker_symbol, SYMBOL_TRADE_TICK_VALUE);
   double tick_size  = SymbolInfoDouble(broker_symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick_value <= 0) tick_value = point; // fallback
   if(tick_size <= 0) tick_size = point;
   // value per point per 1.0 lot
   double value_per_pt = tick_value * (point / tick_size);
   if(value_per_pt <= 0) return 0.0;

   double lots_raw = risk_amount / (sl_points * value_per_pt);
   return NormalizeLots(broker_symbol, lots_raw, MaxLotsPerOrder);
  }

//+------------------------------------------------------------------+
//| Positions                                                        |
//+------------------------------------------------------------------+
int CountEaPositions()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(g_position.SelectByIndex(i))
        {
         if(g_position.Magic() == MagicNumber) n++;
        }
     }
   return n;
  }

bool HasPositionFor(const string broker_symbol, const string comment_key)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!g_position.SelectByIndex(i)) continue;
      if(g_position.Magic() != MagicNumber) continue;
      if(g_position.Symbol() != broker_symbol) continue;
      if(StringFind(g_position.Comment(), comment_key) >= 0) return true;
     }
   return false;
  }

void CloseAllEaPositions()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!g_position.SelectByIndex(i)) continue;
      if(g_position.Magic() != MagicNumber) continue;
      g_trade.PositionClose(g_position.Ticket());
     }
  }

//+------------------------------------------------------------------+
//| Gateway calls                                                    |
//+------------------------------------------------------------------+
string SignalUid(const string canonical, const string sweep_ts)
  {
   return canonical + "|" + sweep_ts;
  }

// Best-effort parse of ISO-8601 prefix YYYY-MM-DDTHH:MM:SS (optional frac/offset).
datetime ParseIsoPrefix(const string ts)
  {
   if(StringLen(ts) < 19) return 0;
   int y = (int)StringToInteger(StringSubstr(ts, 0, 4));
   int m = (int)StringToInteger(StringSubstr(ts, 5, 2));
   int d = (int)StringToInteger(StringSubstr(ts, 8, 2));
   int hh = (int)StringToInteger(StringSubstr(ts, 11, 2));
   int mm = (int)StringToInteger(StringSubstr(ts, 14, 2));
   int ss = (int)StringToInteger(StringSubstr(ts, 17, 2));
   if(y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return 0;
   MqlDateTime dt;
   dt.year = y; dt.mon = m; dt.day = d;
   dt.hour = hh; dt.min = mm; dt.sec = ss;
   return StructToTime(dt);
  }

bool Handshake(string &err)
  {
   err = "";
   string payload = "{\"token\":\"" + g_token + "\",\"action\":\"handshake\"}";
   string resp;
   if(!HttpPostJson(payload, resp, err))
     {
      g_connected = false;
      return false;
     }
   bool ok = false;
   JsonGetBool(resp, "ok", ok);
   if(!ok)
     {
      JsonGetString(resp, "error", err);
      if(err == "") err = "handshake_not_ok";
      g_connected = false;
      return false;
     }
   JsonGetBool(resp, "entitled", g_entitled);
   JsonGetString(resp, "plan_slug", g_plan_slug);
   JsonGetString(resp, "plan_uuid", g_plan_uuid);
   JsonGetString(resp, "sub_status", g_sub_status);
   // Entitlement TTL (2026-09-29): poll does not re-read subscriptions.
   // Re-handshake at min(HandshakeIntervalSec, period_end - 1h).
   string ent_until = "";
   if(!JsonGetString(resp, "entitled_until", ent_until) || ent_until == "")
      JsonGetString(resp, "period_end", ent_until);
   datetime pe = ParseIsoPrefix(ent_until);
   datetime ttl = TimeCurrent() + HandshakeIntervalSec;
   if(pe > 0 && pe > TimeCurrent() + 3600)
      ttl = MathMin(ttl, pe - 3600);
   g_entitled_until = ttl;
   // Option A: Realtime push credentials from handshake (plugin parity)
   JsonGetString(resp, "realtime_url", g_rt_url);
   JsonGetString(resp, "realtime_apikey", g_rt_apikey);
   JsonGetString(resp, "realtime_topic", g_rt_topic);
   JsonGetString(resp, "realtime_vsn", g_rt_vsn);
   if(TransportMode == OTC_TRANSPORT_WS_PUSH && g_rt_url != "" && g_rt_topic != "")
     {
      g_rt.Configure(g_rt_url, g_rt_apikey, g_rt_topic, g_rt_vsn);
      if(!g_rt.Ready())
         g_rt.Connect();
     }
   g_connected = true;
   g_last_handshake = TimeCurrent();

   // reload plan symbols (for roster / mapping diagnostics)
   string body;
   if(JsonGetArrayBody(resp, "symbols", body))
     {
      string objs[];
      int n = JsonSplitObjects(body, objs);
      ArrayResize(g_plan_symbols, 0);
      for(int i = 0; i < n; i++)
        {
         string sym;
         if(JsonGetString(objs[i], "symbol", sym))
           {
            int sz = ArraySize(g_plan_symbols);
            ArrayResize(g_plan_symbols, sz + 1);
            g_plan_symbols[sz] = sym;
           }
        }
     }
   return true;
  }

bool PollSignals(string &signals_json, string &err)
  {
   err = "";
   string payload = "{\"token\":\"" + g_token + "\",\"action\":\"poll\"}";
   string resp;
   if(!HttpPostJson(payload, resp, err))
     {
      g_connected = false;
      return false;
     }
   bool ok = false;
   JsonGetBool(resp, "ok", ok);
   if(!ok)
     {
      JsonGetString(resp, "error", err);
      if(err == "") err = "poll_not_ok";
      g_connected = false;
      return false;
     }
   JsonGetBool(resp, "entitled", g_entitled);
   JsonGetString(resp, "sub_status", g_sub_status);
   g_connected = true;
   string body;
   if(!JsonGetArrayBody(resp, "signals", body))
     {
      signals_json = "";
      return true;
     }
   signals_json = body;
   return true;
  }

//+------------------------------------------------------------------+
//| Signal processing                                                |
//+------------------------------------------------------------------+
void ProcessSignals(const string signals_body)
  {
   string objs[];
   int n = JsonSplitObjects(signals_body, objs);
   for(int i = 0; i < n; i++)
     {
      ProcessOneSignal(objs[i]);
     }
  }

void ProcessOneSignal(const string obj)
  {
   string canonical, side, sweep_ts;
   double entry = 0, sl = 0, tp = 0;
   bool qualified = false;

   if(!JsonGetString(obj, "symbol", canonical)) return;
   if(!JsonGetString(obj, "signal", side)) return;
   if(!JsonGetString(obj, "sweep_timestamp", sweep_ts)) return;
   JsonGetBool(obj, "qualified", qualified);
   if(!qualified) return;
   if(side != "buy" && side != "sell") return;

   JsonGetNumber(obj, "entry_price", entry);
   JsonGetNumber(obj, "stop_loss", sl);
   JsonGetNumber(obj, "take_profit", tp);

   string uid = SignalUid(canonical, sweep_ts);
   if(StateHas(uid))
      return; // idempotent - already handled

   // Staleness: skip old rows (sleep / reconnect). Unparsed timestamps pass.
   datetime sweep_time = ParseIsoPrefix(sweep_ts);
   if(sweep_time > 0 && MaxSignalAgeSec > 0)
     {
      datetime now = TimeCurrent();
      // If server timestamps are UTC and terminal is local this is approximate.
      int age = (int)(now - sweep_time);
      if(age > MaxSignalAgeSec && age < 86400 * 30)
        {
         Print("Talaria Copy: STALE: ", canonical, " age_s=", age, " uid=", uid);
         StateAdd(uid);
         return;
        }
     }

   if(!EnableTrading)
     {
      Print("Talaria Copy: SHADOW/CONSENT: would trade ", canonical, " ", side,
            " entry=", entry, " sl=", sl, " tp=", tp, " uid=", uid);
      StateAdd(uid);
      ChartComment();
      return;
     }
   if(g_paused)
     {
      Print("Talaria Copy: PAUSED: skip ", canonical, " ", side, " uid=", uid);
      return;
     }
   if(!g_entitled)
     {
      Print("Talaria Copy: NOT ENTITLED (", g_sub_status, "): skip ", canonical, " ", side);
      return;
     }
   if(CountEaPositions() >= MaxOpenPositions)
     {
      Print("Talaria Copy: MAX OPEN: skip ", canonical, " uid=", uid);
      StateAdd(uid);
      return;
     }

   string broker_symbol = MapSymbol(canonical);
   if(broker_symbol == "")
     {
      Print("Talaria Copy: UNMAPPED SYMBOL: ", canonical, " - journal only");
      g_last_error = "unmapped:" + canonical;
      ChartComment();
      return;
     }

   string comment_key = OTC_COMMENT_PREFIX + StringSubstr(uid, 0, 24);
   if(HasPositionFor(broker_symbol, comment_key))
     {
      StateAdd(uid);
      return;
     }

   if(!SymbolSelect(broker_symbol, true))
     {
      Print("Talaria Copy: SYMBOL SELECT FAIL: ", broker_symbol);
      return;
     }

   double lots = ComputeLots(broker_symbol, side, entry, sl);
   if(lots <= 0)
     {
      Print("Talaria Copy: LOT=0 for ", broker_symbol, " entry=", entry, " sl=", sl, " - skip");
      StateAdd(uid);
      return;
     }

   if(Mode == OTC_MODE_SHADOW)
     {
      Print("Talaria Copy: SHADOW: ", side, " ", broker_symbol, " lots=", lots,
            " entry=", entry, " sl=", sl, " tp=", tp, " uid=", uid);
      StateAdd(uid);
      ChartComment();
      return;
     }

   if(Mode == OTC_MODE_CONFIRM)
     {
      // One-click confirm: light chart BUY/SELL (same SL/TP/lots as live).
      SetPendingSignal(uid, canonical, broker_symbol, side, entry, sl, tp, lots);
      StateAdd(uid);
      return;
     }

   // LIVE — auto
   SendMarketOrder(broker_symbol, side, entry, sl, tp, lots, uid);
  }

// ── Confirm-mode pending signal (chart BUY/SELL) ──────────────────────────
void SetPendingSignal(const string uid, const string canonical, const string broker,
                      const string side, const double entry, const double sl,
                      const double tp, const double lots)
  {
   g_pend_active = true;
   g_pend_uid = uid;
   g_pend_symbol = canonical;
   g_pend_broker = broker;
   g_pend_side = side;
   g_pend_entry = entry;
   g_pend_sl = sl;
   g_pend_tp = tp;
   g_pend_lots = lots;
   g_pend_until = TimeCurrent() + MathMax(30, ConfirmTimeoutSec);
   Print("Talaria Copy: CONFIRM pending ", side, " ", canonical,
         " entry=", entry, " sl=", sl, " tp=", tp, " lots=", lots,
         " timeout_s=", ConfirmTimeoutSec);
   DrawConfirmButtons();
   ChartComment();
  }

void ClearPendingSignal()
  {
   g_pend_active = false;
   g_pend_uid = "";
   g_pend_side = "";
   g_pend_until = 0;
   HideConfirmButtons();
   ChartComment();
  }

void DrawConfirmButtons()
  {
   bool is_buy = (g_pend_side == "buy");
   string lots_s = DoubleToString(g_pend_lots, 2);
   string label = StringFormat("%s %s  lots=%s  sl=%.5f tp=%.5f",
                               is_buy ? "BUY" : "SELL", g_pend_symbol, lots_s,
                               g_pend_sl, g_pend_tp);

   // BUY
   ObjectCreate(0, "OTC_BTN_BUY", OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_XDISTANCE, 12);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_YDISTANCE, 80);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_XSIZE, 110);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_YSIZE, 28);
   ObjectSetString(0, "OTC_BTN_BUY", OBJPROP_TEXT, "BUY");
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_BGCOLOR, is_buy ? clrMediumBlue : clrDimGray);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_STATE, false);
   ObjectSetInteger(0, "OTC_BTN_BUY", OBJPROP_SELECTABLE, false);

   // SELL
   ObjectCreate(0, "OTC_BTN_SELL", OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_XDISTANCE, 12);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_YDISTANCE, 112);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_XSIZE, 110);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_YSIZE, 28);
   ObjectSetString(0, "OTC_BTN_SELL", OBJPROP_TEXT, "SELL");
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_BGCOLOR, !is_buy ? clrFireBrick : clrDimGray);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_STATE, false);
   ObjectSetInteger(0, "OTC_BTN_SELL", OBJPROP_SELECTABLE, false);

   ObjectCreate(0, "OTC_LBL_PEND", OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, "OTC_LBL_PEND", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "OTC_LBL_PEND", OBJPROP_XDISTANCE, 12);
   ObjectSetInteger(0, "OTC_LBL_PEND", OBJPROP_YDISTANCE, 148);
   ObjectSetString(0, "OTC_LBL_PEND", OBJPROP_TEXT, label);
   ObjectSetInteger(0, "OTC_LBL_PEND", OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, "OTC_LBL_PEND", OBJPROP_FONTSIZE, 8);
   ChartRedraw();
  }

void HideConfirmButtons()
  {
   ObjectDelete(0, "OTC_BTN_BUY");
   ObjectDelete(0, "OTC_BTN_SELL");
   ObjectDelete(0, "OTC_LBL_PEND");
   ChartRedraw();
  }

void PlacePendingTrade()
  {
   if(!g_pend_active) return;
   if(g_paused)
     {
      Print("Talaria Copy: CONFIRM ignored - paused");
      return;
     }
   if(!g_entitled)
     {
      Print("Talaria Copy: CONFIRM ignored - not entitled");
      return;
     }
   if(!EnableTrading)
     {
      Print("Talaria Copy: CONFIRM preview only (EnableTrading=false): ",
            g_pend_side, " ", g_pend_broker);
      ClearPendingSignal();
      return;
     }
   if(TimeCurrent() > g_pend_until)
     {
      Print("Talaria Copy: CONFIRM expired ", g_pend_uid);
      ClearPendingSignal();
      return;
     }
   SendMarketOrder(g_pend_broker, g_pend_side, g_pend_entry, g_pend_sl, g_pend_tp,
                   g_pend_lots, g_pend_uid);
   ClearPendingSignal();
  }

void SendMarketOrder(const string broker_symbol, const string side,
                     const double entry, const double sl, const double tp,
                     const double lots, const string uid)
  {
   double price = (side == "buy")
                  ? SymbolInfoDouble(broker_symbol, SYMBOL_ASK)
                  : SymbolInfoDouble(broker_symbol, SYMBOL_BID);
   if(price <= 0)
     {
      Print("Talaria Copy: NO PRICE: ", broker_symbol);
      return;
     }

   MqlTradeRequest request;
   MqlTradeResult result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action    = TRADE_ACTION_DEAL;
   request.symbol    = broker_symbol;
   request.volume    = lots;
   request.type      = (side == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price     = price;
   request.deviation = SlippagePoints;
   request.magic     = MagicNumber;
   request.comment   = OTC_COMMENT_PREFIX + StringSubstr(uid, 0, 24);
   request.type_filling = ORDER_FILLING_IOC;
   // SL/TP attached when provided
   if(sl > 0) request.sl = sl;
   if(tp > 0) request.tp = tp;

   bool sent = false;
   for(int attempt = 1; attempt <= RequoteRetries; attempt++)
     {
      ResetLastError();
      sent = OrderSend(request, result);
      if(sent && result.retcode == TRADE_RETCODE_DONE)
        {
         Print("Talaria Copy: FILL: ", side, " ", broker_symbol, " lots=", lots,
               " deal=", result.deal, " order=", result.order, " uid=", uid);
         StateAdd(uid);
         ChartComment();
         return;
        }
      // requote / price off â†' refresh price and retry
      if(result.retcode == TRADE_RETCODE_REQUOTE ||
         result.retcode == TRADE_RETCODE_PRICE_CHANGED ||
         result.retcode == TRADE_RETCODE_PRICE_OFF)
        {
         price = (side == "buy")
                 ? SymbolInfoDouble(broker_symbol, SYMBOL_ASK)
                 : SymbolInfoDouble(broker_symbol, SYMBOL_BID);
         request.price = price;
         Sleep(RequoteDelayMs);
         continue;
        }
      // invalid stops â†' open then modify
      if(result.retcode == TRADE_RETCODE_INVALID_STOPS ||
         result.retcode == TRADE_RETCODE_INVALID_PRICE)
        {
         request.sl = 0;
         request.tp = 0;
         ResetLastError();
         sent = OrderSend(request, result);
         if(sent && (result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED))
           {
            if(sl > 0 || tp > 0)
              {
               g_trade.PositionModify(result.deal > 0 ? result.deal : result.order,
                                      sl > 0 ? sl : 0, tp > 0 ? tp : 0);
              }
            Print("Talaria Copy: FILL (SLTP modify): ", side, " ", broker_symbol, " lots=", lots, " uid=", uid);
            StateAdd(uid);
            ChartComment();
            return;
           }
        }
      break;
     }

   Print("Talaria Copy: ORDER FAIL: ", side, " ", broker_symbol, " retcode=", result.retcode,
         " comment=", result.comment, " uid=", uid);
   g_last_error = "retcode:" + IntegerToString(result.retcode);
   ChartComment();
  }

//+------------------------------------------------------------------+
//| Chart UI                                                         |
//+------------------------------------------------------------------+
string PlanTitle()
  {
   if(g_plan_slug == "precision_pro") return "Precision Pro";
   if(g_plan_slug == "signal_scout")  return "Signal Scout";
   if(g_plan_slug == "basket_scalper") return "Basket Scalper";
   if(g_plan_slug == "") return "-";
   return g_plan_slug;
  }

string SubTitle()
  {
   if(g_sub_status == "active")   return "Active";
   if(g_sub_status == "grace")    return "Grace period";
   if(g_sub_status == "pending")  return "Pending";
   if(g_sub_status == "expired")  return "Expired";
   if(g_sub_status == "cancelled") return "Cancelled";
   if(g_sub_status == "none")     return "No subscription";
   return g_sub_status;
  }

void ChartComment()
  {
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string acct = (login > 0) ? IntegerToString(login) : "not logged in";
   string mode_s = "Shadow";
   if(Mode == OTC_MODE_CONFIRM) mode_s = "Confirm (chart BUY/SELL)";
   else if(Mode == OTC_MODE_LIVE) mode_s = "Live";
   string status = g_connected ? "Connected" : "Not connected";
   string plan = PlanTitle();
   string sub = SubTitle();
   string open_s = IntegerToString(CountEaPositions()) + " / " + IntegerToString(MaxOpenPositions);
   string sym_s = IntegerToString(ArraySize(g_plan_symbols));

   string txt;
   txt += "Talaria Copy\n";
   txt += "-------------------------\n";
   txt += "Status:  " + status + "\n";
   txt += "Plan:    " + plan + "  |  " + sub + "\n";
   txt += "Account: " + acct + "\n";
   txt += "Mode:    " + mode_s + "\n";
   txt += "Open:    " + open_s + " positions\n";
   txt += "Symbols: " + sym_s + " in plan\n";

   if(g_paused)
      txt += "\nPaused - click Resume to continue\n";
   else if(g_pend_active)
      txt += "\nSIGNAL WAITING - click BUY or SELL (expires " +
             TimeToString(g_pend_until, TIME_MINUTES) + ")\n";
   else if(!EnableTrading)
      txt += "\nWatching only. To place orders:\n";
   else if(Mode == OTC_MODE_SHADOW)
      txt += "\nWatching only. To place orders:\n";
   else if(!g_entitled)
      txt += "\nOrders blocked - subscription not active\n";
   else
      txt += "\nCopying signals...\n";

   if(!EnableTrading || Mode == OTC_MODE_SHADOW)
     {
      txt += "1. Open EA inputs\n";
      txt += "2. Set Place orders = Yes\n";
      txt += "3. Set Mode = Live\n";
     }

   if(StringLen(g_last_error) > 0)
      txt += "\nLast issue: " + g_last_error + "\n";

   Comment(txt);
  }

void DrawButtons()
  {
   // Close All
   ObjectCreate(0, "OTC_BTN_CLOSE", OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_XDISTANCE, 12);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_YDISTANCE, 20);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_XSIZE, 110);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_YSIZE, 22);
   ObjectSetString(0, "OTC_BTN_CLOSE", OBJPROP_TEXT, "Close all");
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_BGCOLOR, clrFireBrick);
   ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_COLOR, clrWhite);

   ObjectCreate(0, "OTC_BTN_PAUSE", OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_XDISTANCE, 12);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_YDISTANCE, 48);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_XSIZE, 110);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_YSIZE, 22);
   ObjectSetString(0, "OTC_BTN_PAUSE", OBJPROP_TEXT, g_paused ? "Resume" : "Pause");
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_BGCOLOR, clrDarkSlateGray);
   ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_COLOR, clrWhite);
  }

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit()
  {
   g_chart_id = ChartID();
   g_trade.SetExpertMagicNumber(MagicNumber);
   g_trade.SetDeviationInPoints(SlippagePoints);
   g_trade.SetTypeFillingBySymbol(Symbol());

   BuildSymbolMap();

   g_token = LoadToken();
   if(StringLen(g_token) == 0)
     {
      g_last_error = "Claim token missing";
      Alert("Talaria Copy: claim token not found.\n",
            "1. Sign in at nobletrading.app and open the portal\n",
            "2. Click Reveal credentials and copy the token\n",
            "3. Save it as MQL5\\Files\\", TokenFilePath, "\n",
            "4. Re-attach this EA");
      ChartComment();
      DrawButtons();
      return INIT_SUCCEEDED; // stay loaded so the user can fix the file
     }

   if(StringFind(EndpointURL, "https://") != 0)
     {
      g_last_error = "Invalid connection address";
      Alert("Talaria Copy: the signal service address must start with https://");
      ChartComment();
      DrawButtons();
      return INIT_FAILED;
     }

   EventSetTimer(MathMax(1, PollIntervalSec));

   string err;
   if(!Handshake(err))
     {
      g_last_error = err;
      Print("Talaria Copy: connection failed - ", err);
     }
   else
     {
      Print("Talaria Copy: connected - plan ", g_plan_slug,
            ", ", ArraySize(g_plan_symbols), " symbols, subscription ", g_sub_status);
     }
   ChartComment();
   DrawButtons();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectDelete(0, "OTC_BTN_CLOSE");
   ObjectDelete(0, "OTC_BTN_PAUSE");
   HideConfirmButtons();
   Comment("");
  }

void OnTick()
  {
   // trading is timer-driven; tick only refreshes the panel
   ChartComment();
  }

void OnTimer()
  {
   // Expire confirm-mode BUY/SELL if the trader never clicked
   if(g_pend_active && TimeCurrent() > g_pend_until)
     {
      Print("Talaria Copy: CONFIRM expired ", g_pend_uid);
      ClearPendingSignal();
     }

   if(g_token == "")
     {
      g_token = LoadToken();
      if(g_token == "") { ChartComment(); return; }
     }

   // periodic re-handshake (claim/subscription) � default HandshakeIntervalSec=12h
   if(g_last_handshake == 0 || TimeCurrent() >= g_entitled_until || TimeCurrent() - g_last_handshake > HandshakeIntervalSec)
     {
      string err;
      if(!Handshake(err))
        {
         g_last_error = err;
         Print("Talaria Copy: handshake: ", err);
        }
     }

   // Option A: push path — drain Realtime broadcasts first
   if(TransportMode == OTC_TRANSPORT_WS_PUSH)
     {
      if(!g_rt.Ready() && g_rt_url != "")
         g_rt.Connect();
      string ws_sig = "";
      if(g_rt.Pump(ws_sig))
        {
         ProcessOneSignal(ws_sig);
         ChartComment();
        }
     }

   datetime now = TimeCurrent();
   // REST is the fallback (always) and the primary when WS is off / down
   bool ws_ok = (TransportMode == OTC_TRANSPORT_WS_PUSH && g_rt.Ready());
   if(ws_ok && TransportMode == OTC_TRANSPORT_WS_PUSH)
     {
      // Sparse catch-up poll while WS is healthy (keeps missed frames from
      // unbounded gap without flooding the gateway)
      if(g_last_poll != 0 && now - g_last_poll < MathMax(PollIntervalSec, 600))
        {
         ChartComment();
         return;
        }
     }
   else if(g_last_poll != 0 && now - g_last_poll < PollIntervalSec)
      return;
   g_last_poll = now;

   string body, err;
   if(!PollSignals(body, err))
     {
      g_last_error = err;
      Print("Talaria Copy: poll: ", err);
      ChartComment();
      return;
     }
   if(StringLen(body) > 0)
      ProcessSignals(body);
   ChartComment();
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == "OTC_BTN_CLOSE")
     {
      CloseAllEaPositions();
      ObjectSetInteger(0, "OTC_BTN_CLOSE", OBJPROP_STATE, false);
      Print("Talaria Copy: closed all managed positions");
      ChartComment();
     }
   if(sparam == "OTC_BTN_PAUSE")
     {
      g_paused = !g_paused;
      ObjectSetString(0, "OTC_BTN_PAUSE", OBJPROP_TEXT, g_paused ? "Resume" : "Pause");
      ObjectSetInteger(0, "OTC_BTN_PAUSE", OBJPROP_STATE, false);
      Print("Talaria Copy: ", g_paused ? "paused" : "resumed");
      ChartComment();
     }
   if(sparam == "OTC_BTN_BUY" || sparam == "OTC_BTN_SELL")
     {
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      if(!g_pend_active)
         return;
      string want = (sparam == "OTC_BTN_BUY") ? "buy" : "sell";
      if(want != g_pend_side)
        {
         Print("Talaria Copy: CONFIRM ignore - signal is ", g_pend_side, " not ", want);
         return;
        }
      PlacePendingTrade();
     }
  }
//+------------------------------------------------------------------+

