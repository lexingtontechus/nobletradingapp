//+------------------------------------------------------------------+
//|                                              TalariaRealtime.mqh |
//|                         Noble Trading — Supabase Realtime (Phoenix) |
//|                                                                  |
//| Option A (2026-09-29): EA WebSocket push to Supabase Realtime.   |
//|                                                                  |
//| TLS/WS transport: Windows INBOX winhttp.dll (no third-party DLL  |
//| download). Users only enable: Tools → Options → Expert Advisors  |
//| → "Allow DLL imports". If DLL imports stay off, the session      |
//| reports unavailable and the EA falls back to REST poll.          |
//|                                                                  |
//| Do NOT ship asyncwinhttpwebsockets.dll — not a standard MT5      |
//| component and not a trustworthy install surface.                 |
//+------------------------------------------------------------------+
#property copyright "Noble Trading"
#property strict

// Platform note (2026-09-29):
//   Windows: WebSocket push via inbox winhttp.dll (+ Allow DLL imports).
//   macOS:   MetaTrader 5 is usually the Windows build under Wine. WinHTTP
//            push is NOT a supported Mac path. Use REST poll (WebRequest)
//            — fully cross-platform. TalariaOsIsWindows() gates WS attempts.

bool TalariaOsIsWindows(void)
  {
   string os = TerminalInfoString(TERMINAL_OS_VERSION);
   if(StringFind(os, "Mac") >= 0 || StringFind(os, "Darwin") >= 0 ||
      StringFind(os, "macOS") >= 0 || StringFind(os, "Linux") >= 0 ||
      StringFind(os, "Unix") >= 0)
      return false;
   return true;
  }

bool TalariaOsIsMacLike(void)
  {
   string os = TerminalInfoString(TERMINAL_OS_VERSION);
   return (StringFind(os, "Mac") >= 0 || StringFind(os, "Darwin") >= 0 ||
           StringFind(os, "macOS") >= 0);
  }

// ── Windows inbox WinHTTP (system32\winhttp.dll) — Windows only ──────────
#import "winhttp.dll"
   long  WinHttpOpen(string agent, int access_type, string proxy, string bypass, int flags);
   long  WinHttpConnect(long session, string host, int port, int reserved);
   long  WinHttpOpenRequest(long connect, string verb, string object_name, string version,
                            string referrer, string accept_types, int flags);
   bool  WinHttpSetOption(long handle, int option, long &buffer, int length);
   bool  WinHttpSendRequest(long request, string headers, int headers_len,
                            string optional, int optional_len, int total_len, long context);
   bool  WinHttpReceiveResponse(long request, long reserved);
   bool  WinHttpQueryHeaders(long request, int info_level, string name,
                             long &buffer, int &buffer_len, int &index);
   int   WinHttpWebSocketCompleteUpgrade(long request, long context);
   int   WinHttpWebSocketSend(long ws, int buffer_type, string data, int data_len);
   int   WinHttpWebSocketReceive(long ws, string &buffer, int buffer_len, int &bytes_read, int &buffer_type);
   bool  WinHttpWebSocketClose(long ws, short status, string reason, int reason_len);
   bool  WinHttpCloseHandle(long handle);
#import

#define WINHTTP_ACCESS_TYPE_NO_PROXY      1
#define WINHTTP_FLAG_SECURE               0x00800000
#define WINHTTP_OPTION_UPGRADE_TO_WEBOCKET 114
#define WINHTTP_NO_ADDITIONAL_HEADERS      0
#define WINHTTP_NO_REQUEST_DATA            0
#define WINHTTP_QUERY_FLAG_NUMBER          0x20000000
#define WINHTTP_QUERY_STATUS_CODE          19
#define WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE 0
#define WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE   3
#define WINHTTP_WEB_SOCKET_SUCCESS          0
#define WINHTTP_WEB_SOCKET_E_END_OF_SESSION 12142

//+------------------------------------------------------------------+
//| Phoenix helpers (same frame shape as plugin.js)                  |
//+------------------------------------------------------------------+
string JsonEscape(const string s)
  {
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\n", "\\n");
   StringReplace(out, "\r", "\\r");
   StringReplace(out, "\t", "\\t");
   return out;
  }

string TalariaRealtimeWsUrl(const string base_url, const string apikey, const string vsn)
  {
   string host_path = base_url;
   StringReplace(host_path, "https://", "");
   StringReplace(host_path, "http://", "");
   StringReplace(host_path, "wss://", "");
   StringReplace(host_path, "ws://", "");
   while(StringLen(host_path) > 0 && StringGetCharacter(host_path, 0) == '/')
      host_path = StringSubstr(host_path, 1);
   while(StringLen(host_path) > 0 && StringGetCharacter(host_path, StringLen(host_path) - 1) == '/')
      host_path = StringSubstr(host_path, 0, StringLen(host_path) - 1);
   string v = vsn;
   if(v == "") v = "1.0.0";
   return "wss://" + host_path + "/realtime/v1/websocket?apikey=" + apikey + "&vsn=" + v;
  }

string PhoenixJoinFrame(const string topic, const string ref_id)
  {
   return "{\"topic\":\"" + JsonEscape(topic) + "\",\"event\":\"phx_join\","
          "\"payload\":{\"config\":{\"broadcast\":{\"self\":false,\"ack\":false}}},"
          "\"ref\":\"" + JsonEscape(ref_id) + "\"}";
  }

string PhoenixHeartbeatFrame(const string ref_id)
  {
   return "{\"topic\":\"phoenix\",\"event\":\"heartbeat\",\"payload\":{},\"ref\":\""
          + JsonEscape(ref_id) + "\"}";
  }

string PhoenixParseEvent(const string raw, string &out_signal_json, string &out_ref, string &out_status)
  {
   out_signal_json = "";
   out_ref = "";
   out_status = "";
   int pe = StringFind(raw, "\"event\"");
   if(pe < 0) return "other";
   int i = pe + 7;
   int n = StringLen(raw);
   while(i < n && StringGetCharacter(raw, i) != ':') i++;
   i++;
   while(i < n && (StringGetCharacter(raw, i) == ' ' || StringGetCharacter(raw, i) == '\t')) i++;
   string ev = "";
   if(i < n && StringGetCharacter(raw, i) == '"')
     {
      int start = i + 1, end = start;
      while(end < n && StringGetCharacter(raw, end) != '"') end++;
      ev = StringSubstr(raw, start, end - start);
     }
   if(ev == "phx_reply" || ev == "phx_error" || ev == "phx_close" || ev == "phoenix")
      return ev;
   if(ev == "broadcast")
     {
      int lp = StringFind(raw, "\"payload\"");
      int last = lp;
      while(true)
        {
         int nxt = StringFind(raw, "\"payload\"", last + 1);
         if(nxt < 0) break;
         last = nxt;
        }
      int pc = StringFind(raw, ":", last);
      int b = pc + 1;
      while(b < n && (StringGetCharacter(raw, b) == ' ' || StringGetCharacter(raw, b) == '\t')) b++;
      if(b < n && StringGetCharacter(raw, b) == '{')
        {
         int depth = 0, k = b;
         for(; k < n; k++)
           {
            ushort c = StringGetCharacter(raw, k);
            if(c == '{') depth++;
            else if(c == '}') { depth--; if(depth == 0) break; }
           }
         out_signal_json = StringSubstr(raw, b, k - b + 1);
        }
      return "broadcast";
     }
   return "other";
  }

// Parse wss://host/path?query → host, port, path
bool SplitWsUrl(const string url, string &host, int &port, string &path)
  {
   host = ""; port = 443; path = "/";
   string u = url;
   if(StringFind(u, "wss://") == 0) { port = 443; u = StringSubstr(u, 6); }
   else if(StringFind(u, "ws://") == 0) { port = 80; u = StringSubstr(u, 5); }
   else return false;
   int slash = StringFind(u, "/");
   string hostport = (slash >= 0) ? StringSubstr(u, 0, slash) : u;
   path = (slash >= 0) ? StringSubstr(u, slash) : "/";
   int colon = StringFind(hostport, ":");
   if(colon >= 0)
     {
      host = StringSubstr(hostport, 0, colon);
      port = (int)StringToInteger(StringSubstr(hostport, colon + 1));
     }
   else host = hostport;
   return (host != "");
  }

//+------------------------------------------------------------------+
//| WinHTTP WebSocket transport (inbox DLL — no 3rd-party download)   |
//+------------------------------------------------------------------+
class CTalariaWsTransport
  {
private:
   long  m_session;
   long  m_connect;
   long  m_request;
   long  m_ws;
   bool  m_open;

public:
            CTalariaWsTransport(void) : m_session(0), m_connect(0), m_request(0), m_ws(0), m_open(false) {}

   bool     Available(void) const { return m_open; }

   bool     Open(const string url, const int timeout_ms)
     {
      Close();
      if(!TalariaOsIsWindows())
        {
         Print("Talaria Realtime: non-Windows OS (",
               TerminalInfoString(TERMINAL_OS_VERSION),
               ") — WS push skipped, REST poll is the transport");
         return false;
        }
      string host, path;
      int port = 443;
      if(!SplitWsUrl(url, host, port, path))
        {
         Print("Talaria Realtime: bad ws url");
         return false;
        }
      m_session = WinHttpOpen("TalariaCopy/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY, "", "", 0);
      if(m_session == 0) { Print("Talaria Realtime: WinHttpOpen failed"); return false; }
      m_connect = WinHttpConnect(m_session, host, port, 0);
      if(m_connect == 0) { Print("Talaria Realtime: WinHttpConnect failed"); Close(); return false; }
      m_request = WinHttpOpenRequest(m_connect, "GET", path, "", "", "",
                                     WINHTTP_FLAG_SECURE);
      if(m_request == 0) { Print("Talaria Realtime: WinHttpOpenRequest failed"); Close(); return false; }

      // Enable WebSocket upgrade
      long upgrade = 1;
      if(!WinHttpSetOption(m_request, WINHTTP_OPTION_UPGRADE_TO_WEBOCKET, upgrade, sizeof(upgrade)))
        {
         Print("Talaria Realtime: set websocket option failed (enable Allow DLL imports)");
         Close();
         return false;
        }
      if(!WinHttpSendRequest(m_request, "", WINHTTP_NO_ADDITIONAL_HEADERS,
                             "", WINHTTP_NO_REQUEST_DATA, 0, 0)
         || !WinHttpReceiveResponse(m_request, 0))
        {
         Print("Talaria Realtime: HTTP upgrade request failed");
         Close();
         return false;
        }
      m_ws = WinHttpWebSocketCompleteUpgrade(m_request, 0);
      if(m_ws == 0)
        {
         Print("Talaria Realtime: websocket upgrade failed");
         Close();
         return false;
        }
      m_open = true;
      Print("Talaria Realtime: WSS open ", host, path);
      return true;
     }

   bool     Send(const string text)
     {
      if(!m_open) return false;
      int rc = WinHttpWebSocketSend(m_ws, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,
                                    text, StringLen(text));
      return (rc == WINHTTP_WEB_SOCKET_SUCCESS);
     }

   bool     Recv(string &text, const int timeout_ms)
     {
      text = "";
      if(!m_open) return false;
      // Non-blocking-ish: one receive; empty result if no frame.
      // (WinHTTP receive is blocking — for timeout control use a short
      //  session or keep timer-driven Pump with REST fallback.)
      uchar buf[];
      ArrayResize(buf, 65536);
      int bread = 0, btype = 0;
      // MQL5 cannot pass uchar[] to all DLL ABIs reliably — use string buffer
      string tmp = "";
      int rc = WinHttpWebSocketReceive(m_ws, tmp, 65536, bread, btype);
      if(rc != WINHTTP_WEB_SOCKET_SUCCESS && rc != WINHTTP_WEB_SOCKET_E_END_OF_SESSION)
         return false;
      if(rc == WINHTTP_WEB_SOCKET_E_END_OF_SESSION)
        {
         m_open = false;
         return false;
        }
      if(bread <= 0) return false;
      text = StringSubstr(tmp, 0, MathMin(bread, StringLen(tmp)));
      return (text != "");
     }

   void     Close(void)
     {
      if(m_ws != 0)
        {
         WinHttpWebSocketClose(m_ws, 1000, "", 0);
         WinHttpCloseHandle(m_ws);
         m_ws = 0;
        }
      if(m_request != 0) { WinHttpCloseHandle(m_request); m_request = 0; }
      if(m_connect != 0) { WinHttpCloseHandle(m_connect); m_connect = 0; }
      if(m_session != 0) { WinHttpCloseHandle(m_session); m_session = 0; }
      m_open = false;
     }
  };

//+------------------------------------------------------------------+
//| Session: connect → join → heartbeat → dispatch broadcasts        |
//+------------------------------------------------------------------+
class CTalariaRealtimeSession
  {
private:
   CTalariaWsTransport m_ws;
   string   m_url;
   string   m_topic;
   bool     m_joined;
   int      m_ref;
   datetime m_last_beat;

public:
            CTalariaRealtimeSession(void) : m_joined(false), m_ref(0), m_last_beat(0) {}

   void     Configure(const string base_url, const string apikey, const string topic, const string vsn)
     {
      m_url = TalariaRealtimeWsUrl(base_url, apikey, vsn);
      m_topic = topic;
     }

   bool     Ready(void) const { return m_joined && m_ws.Available(); }
   string   Topic(void) const { return m_topic; }
   string   Url(void) const { return m_url; }

   bool     Connect(void)
     {
      if(m_url == "" || m_topic == "")
        {
         Print("Talaria Realtime: not configured (need handshake realtime_* fields)");
         return false;
        }
      m_ws.Close();
      m_joined = false;
      if(!m_ws.Open(m_url, 8000))
        {
         Print("Talaria Realtime: WSS unavailable — REST fallback. ",
               "If WinHttp* failed: Tools → Options → Expert Advisors → Allow DLL imports.");
         return false;
        }
      m_ref++;
      if(!m_ws.Send(PhoenixJoinFrame(m_topic, IntegerToString(m_ref))))
        {
         Print("Talaria Realtime: join send failed");
         m_ws.Close();
         return false;
        }
      m_joined = true;
      m_last_beat = TimeCurrent();
      Print("Talaria Realtime: joined ", m_topic);
      return true;
     }

   bool     Pump(string &signal_json)
     {
      signal_json = "";
      if(!m_ws.Available()) return false;
      if(TimeCurrent() - m_last_beat >= 30)
        {
         m_ref++;
         m_ws.Send(PhoenixHeartbeatFrame(IntegerToString(m_ref)));
         m_last_beat = TimeCurrent();
        }
      string raw = "";
      if(!m_ws.Recv(raw, 0))
         return false;
      string sig, ref, st;
      string ev = PhoenixParseEvent(raw, sig, ref, st);
      if(ev == "broadcast" && sig != "")
        {
         signal_json = sig;
         return true;
        }
      if(ev == "phx_error" || ev == "phx_close")
        {
         Print("Talaria Realtime: socket error/close");
         m_joined = false;
         m_ws.Close();
        }
      return false;
     }

   void     Disconnect(void)
     {
      m_ws.Close();
      m_joined = false;
     }
  };
