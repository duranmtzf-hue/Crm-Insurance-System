# Script PowerShell para configurar Gmail y arrancar el servidor
# IMPORTANTE: Reemplaza los valores con tu correo y contraseña de aplicación REALES

$env:GMAIL_USER = "TU_CORREO_GMAIL_AQUI@gmail.com"
$env:GMAIL_PASS = "TU_CONTRASEÑA_DE_APLICACION_AQUI"

Write-Host "Configurando variables de entorno..." -ForegroundColor Green
Write-Host "GMAIL_USER: $env:GMAIL_USER" -ForegroundColor Cyan
Write-Host "GMAIL_PASS: [OCULTO]" -ForegroundColor Cyan
Write-Host ""
Write-Host "Iniciando servidor..." -ForegroundColor Yellow

npm start

