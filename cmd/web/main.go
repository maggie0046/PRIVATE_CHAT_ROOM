package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"goLearning/pkg/utils"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type wsMessage struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Data string `json:"data,omitempty"`
	Host string `json:"host,omitempty"`
	Port string `json:"port,omitempty"`
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	port := "8080"
	if len(os.Args) > 1 {
		port = os.Args[1]
	}

	webDir := filepath.Join(".", "web")
	http.Handle("/", http.FileServer(http.Dir(webDir)))
	http.HandleFunc("/ws", handleWS)

	fmt.Println("web ui listening on :" + port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		panic(err)
	}
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	ws.SetReadDeadline(time.Now().Add(30 * time.Second))
	var connect wsMessage
	if err := ws.ReadJSON(&connect); err != nil || connect.Type != "connect" {
		return
	}
	ws.SetReadDeadline(time.Time{})

	host := strings.TrimSpace(connect.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := strings.TrimSpace(connect.Port)
	if port == "" {
		writeJSON(ws, wsMessage{Type: "error", Text: "missing port"})
		return
	}
	tcpConn, err := net.Dial("tcp", net.JoinHostPort(host, port))
	if err != nil {
		writeJSON(ws, wsMessage{Type: "error", Text: "tcp connect failed"})
		return
	}
	defer tcpConn.Close()

	writeJSON(ws, wsMessage{Type: "status", Text: "connected"})

	var writeMu sync.Mutex
	safeWrite := func(msg wsMessage) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = ws.WriteJSON(msg)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			data, err := utils.ReadFrame(tcpConn)
			if err != nil {
				safeWrite(wsMessage{Type: "status", Text: "disconnected"})
				return
			}
			if len(data) == 0 {
				continue
			}
			safeWrite(wsMessage{Type: "frame", Data: encodeBase64(data)})
		}
	}()

	for {
		var msg wsMessage
		if err := ws.ReadJSON(&msg); err != nil {
			return
		}
		select {
		case <-done:
			return
		default:
		}

		if msg.Type == "frame" && strings.TrimSpace(msg.Data) != "" {
			raw, err := decodeBase64(strings.TrimSpace(msg.Data))
			if err != nil {
				safeWrite(wsMessage{Type: "error", Text: "invalid frame data"})
				continue
			}
			if err := utils.WriteFrame(tcpConn, raw); err != nil {
				safeWrite(wsMessage{Type: "status", Text: "send failed"})
				return
			}
		}
	}
}

func writeJSON(ws *websocket.Conn, msg wsMessage) {
	_ = ws.WriteMessage(websocket.TextMessage, mustJSON(msg))
}

func mustJSON(msg wsMessage) []byte {
	b, _ := json.Marshal(msg)
	return b
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func decodeBase64(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
