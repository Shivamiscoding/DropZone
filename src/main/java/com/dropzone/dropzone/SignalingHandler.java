package com.dropzone.dropzone;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();
    
    // Map of ip -> Map of sessionId -> Session
    private final Map<String, Map<String, WebSocketSession>> rooms = new ConcurrentHashMap<>();
    private final Map<String, String> sessionToIp = new ConcurrentHashMap<>();
    private final Map<String, String> sessionToName = new ConcurrentHashMap<>();
    
    private final String[] ADJECTIVES = {"Happy", "Cool", "Fast", "Brave", "Smart", "Wild"};
    private final String[] ANIMALS = {"Fox", "Bear", "Wolf", "Hawk", "Lion", "Tiger"};
    private final Random random = new Random();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String ip = "global_room"; // Group all local devices together for testing
        
        String sessionId = session.getId();
        
        sessionToIp.put(sessionId, ip);
        
        String name = ADJECTIVES[random.nextInt(ADJECTIVES.length)] + " " + ANIMALS[random.nextInt(ANIMALS.length)];
        sessionToName.put(sessionId, name);

        rooms.putIfAbsent(ip, new ConcurrentHashMap<>());
        rooms.get(ip).put(sessionId, session);

        // Send identity to self
        Map<String, Object> identityMsg = new HashMap<>();
        identityMsg.put("type", "identity");
        identityMsg.put("id", sessionId);
        identityMsg.put("name", name);
        sendMessage(session, identityMsg);

        // Notify others in room and send current list to self
        broadcastPeerList(ip);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode payload = objectMapper.readTree(message.getPayload());
        String type = payload.get("type").asText();
        String toId = payload.has("to") ? payload.get("to").asText() : null;
        String fromId = session.getId();

        if ("set-name".equals(type)) {
            String name = payload.has("name") ? payload.get("name").asText() : "Device";
            sessionToName.put(fromId, name);
            
            // Send updated identity to self
            Map<String, Object> identityMsg = new HashMap<>();
            identityMsg.put("type", "identity");
            identityMsg.put("id", fromId);
            identityMsg.put("name", name);
            sendMessage(session, identityMsg);
            
            // Broadcast update to others
            String ip = sessionToIp.get(fromId);
            if (ip != null) {
                broadcastPeerList(ip);
            }
            return;
        }

        if (toId != null) {
            String ip = sessionToIp.get(toId);
            if (ip != null) {
                Map<String, WebSocketSession> room = rooms.get(ip);
                if (room != null) {
                    WebSocketSession targetSession = room.get(toId);
                    if (targetSession != null && targetSession.isOpen()) {
                        // Forward message
                        Map<String, Object> forwardedMsg = new HashMap<>();
                        forwardedMsg.put("type", type);
                        forwardedMsg.put("from", fromId);
                        
                        if (payload.has("sdp")) {
                            forwardedMsg.put("sdp", objectMapper.convertValue(payload.get("sdp"), Map.class));
                        }
                        if (payload.has("candidate")) {
                            forwardedMsg.put("candidate", objectMapper.convertValue(payload.get("candidate"), Map.class));
                        }
                        
                        sendMessage(targetSession, forwardedMsg);
                    }
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = session.getId();
        String ip = sessionToIp.remove(sessionId);
        sessionToName.remove(sessionId);
        
        if (ip != null) {
            Map<String, WebSocketSession> room = rooms.get(ip);
            if (room != null) {
                room.remove(sessionId);
                if (room.isEmpty()) {
                    rooms.remove(ip);
                } else {
                    broadcastPeerList(ip);
                }
            }
        }
    }
    
    private void broadcastPeerList(String ip) {
        Map<String, WebSocketSession> room = rooms.get(ip);
        if (room == null) return;
        
        List<Map<String, String>> peerList = new ArrayList<>();
        for (String id : room.keySet()) {
            Map<String, String> peerInfo = new HashMap<>();
            peerInfo.put("id", id);
            peerInfo.put("name", sessionToName.get(id));
            peerList.add(peerInfo);
        }
        
        for (WebSocketSession session : room.values()) {
            List<Map<String, String>> otherPeers = new ArrayList<>(peerList);
            otherPeers.removeIf(p -> p.get("id").equals(session.getId()));
            
            Map<String, Object> msg = new HashMap<>();
            msg.put("type", "peers");
            msg.put("peers", otherPeers);
            
            sendMessage(session, msg);
        }
    }

    private void sendMessage(WebSocketSession session, Map<String, Object> message) {
        try {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
    

}
