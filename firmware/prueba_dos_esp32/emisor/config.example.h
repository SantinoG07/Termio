#pragma once
// Copiar como config.h EN ESTA MISMA CARPETA. No subir secretos a Git.
constexpr const char* WIFI_SSID = "TU_RED_WIFI";
constexpr const char* WIFI_PASSWORD = "TU_PASSWORD_WIFI";
// Copiar EXACTAMENTE el mismo token privado configurado en el receptor.
constexpr const char* TEST_TOKEN = "REEMPLAZAR_POR_UN_TOKEN_PRIVADO_LARGO";
// Reemplazar por la IP que imprime el receptor. Sin /api/status al final.
constexpr const char* RECEIVER_BASE_URL = "http://192.168.1.50";
constexpr unsigned long SEND_INTERVAL_MS = 10000;
