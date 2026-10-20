#pragma once
// Copiar como config.h EN ESTA MISMA CARPETA. No subir secretos a Git.
constexpr const char* WIFI_SSID = "TU_RED_WIFI";
constexpr const char* WIFI_PASSWORD = "TU_PASSWORD_WIFI";
// Mismo token privado en emisor y receptor: minimo 24 caracteres.
constexpr const char* TEST_TOKEN = "REEMPLAZAR_POR_UN_TOKEN_PRIVADO_LARGO";
// false evita borrar datos ante un fallo de montaje.
// Solo en una placa de prueba, sin datos que conservar, poner true para
// inicializar LittleFS si no monta. Despues volver a false y cargar de nuevo.
constexpr bool FORMAT_FS_ON_MOUNT_FAILURE = false;
