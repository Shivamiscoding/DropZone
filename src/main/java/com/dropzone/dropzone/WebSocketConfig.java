package com.dropzone.dropzone;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final SignalingHandler signalingHandler;
    private final IpHandshakeInterceptor ipHandshakeInterceptor;

    public WebSocketConfig(SignalingHandler signalingHandler, IpHandshakeInterceptor ipHandshakeInterceptor) {
        this.signalingHandler = signalingHandler;
        this.ipHandshakeInterceptor = ipHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(signalingHandler, "/signaling")
                .addInterceptors(ipHandshakeInterceptor)
                .setAllowedOrigins("*");
    }
}
