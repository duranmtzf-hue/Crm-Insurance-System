const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'images', 'logo.png');
const outputDir = path.join(__dirname, 'images', 'icons');

// Crear directorio de iconos si no existe
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Tamaños requeridos para PWA
const sizes = [48, 72, 96, 128, 144, 192, 256, 384, 512];

async function generateIcons() {
    console.log('Generando iconos PWA...');
    
    try {
        for (const size of sizes) {
            const outputFile = path.join(outputDir, `icon-${size}x${size}.png`);
            
            await sharp(inputFile)
                .resize(size, size, {
                    fit: 'contain',
                    background: { r: 0, g: 31, b: 63, alpha: 0 } // Fondo transparente
                })
                .png()
                .toFile(outputFile);
            
            console.log(`✓ Generado: icon-${size}x${size}.png`);
        }
        
        // También crear una versión del logo original optimizada
        const optimizedLogo = path.join(outputDir, 'logo-optimized.png');
        await sharp(inputFile)
            .png({ quality: 100 })
            .toFile(optimizedLogo);
        
        console.log('\n✓ Todos los iconos generados exitosamente!');
        console.log(`✓ Iconos guardados en: ${outputDir}`);
        
    } catch (error) {
        console.error('Error generando iconos:', error);
        process.exit(1);
    }
}

generateIcons();

