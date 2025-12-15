@echo off
echo ========================================
echo CRM Insurance System - Iniciando...
echo ========================================
echo.

echo Verificando Node.js...
node --version
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado!
    echo Descarga Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo Verificando dependencias...
if not exist "node_modules" (
    echo Instalando dependencias por primera vez...
    call npm install
    if errorlevel 1 (
        echo ERROR: No se pudieron instalar las dependencias
        pause
        exit /b 1
    )
)

echo.
echo Deteniendo procesos anteriores de Node...
taskkill /F /IM node.exe 2>nul

echo.
echo Iniciando servidor...
echo.
echo ========================================
echo Servidor iniciado!
echo ========================================
echo.
echo Abre tu navegador en: http://localhost:3000
echo.
echo Para acceder al sistema:
echo   - Click en "Acceder al Sistema" en la pagina principal
echo   - O ve a: http://localhost:3000/login
echo.
echo Usuario por defecto:
echo   - Usuario: admin
echo   - Contraseña: admin123
echo.
echo Presiona Ctrl+C para detener el servidor
echo ========================================
echo.

node server.js

pause

