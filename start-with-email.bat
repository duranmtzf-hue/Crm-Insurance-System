@echo off
REM Configura las variables de entorno para Gmail antes de iniciar el servidor
REM IMPORTANTE: Reemplaza los valores con tu correo y contraseña de aplicación REALES

set GMAIL_USER=TU_CORREO_GMAIL_AQUI@gmail.com
set GMAIL_PASS=TU_CONTRASEÑA_DE_APLICACION_AQUI

echo Configurando variables de entorno...
echo GMAIL_USER configurado
echo GMAIL_PASS configurado

REM Inicia el servidor Node.js
npm start

