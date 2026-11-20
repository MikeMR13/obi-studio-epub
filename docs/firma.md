# Firma de los instaladores

El flujo **Instaladores** (pestaña Actions) firma solo si encuentra los secretos del repositorio
(Settings → Secrets and variables → Actions). Sin ellos construye igual, sin firmar, y lo avisa en el registro.

## Windows

Sin firma, SmartScreen avisa al instalar («Windows protegió su PC»). Opciones:

1. **Certificado de firma de código** (OV o EV) de una autoridad como Sectigo, DigiCert o SSL.com.
   Desde 2023 las autoridades entregan la clave en un token o en la nube; pide la variante con
   archivo `.pfx` o firma en la nube compatible con `signtool`.
2. **Azure Trusted Signing** (de Microsoft, más barato), para particulares con identidad verificada.

Con un `.pfx`:

| Secreto | Valor |
| --- | --- |
| `WIN_CSC_LINK` | El `.pfx` en base64 (`base64 -w0 certificado.pfx`, o `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx"))` en PowerShell) |
| `WIN_CSC_KEY_PASSWORD` | Su contraseña |

El flujo comprueba después que la firma del `.exe` es válida. La reputación de SmartScreen crece con
las descargas: con un certificado OV el aviso puede tardar unas semanas en desaparecer.

## macOS

Hace falta una cuenta de Apple Developer (99 USD al año).

| Secreto | Valor |
| --- | --- |
| `MAC_CSC_LINK` | Certificado «Developer ID Application» exportado como `.p12`, en base64 |
| `MAC_CSC_KEY_PASSWORD` | Contraseña del `.p12` |
| `APPLE_ID` | Correo de la cuenta de desarrollador |
| `APPLE_APP_SPECIFIC_PASSWORD` | Contraseña de app creada en appleid.apple.com |
| `APPLE_TEAM_ID` | Identificador del equipo (10 caracteres) |

Con los cinco, el `.dmg` sale firmado y notarizado. Los permisos de `build/entitlements.mac.plist`
dejan que Electron y el Java de EPUBCheck compilen código y carguen sus bibliotecas.

Para construir el de macOS, marca «Construir también para macOS» al lanzar el flujo a mano.

## Linux

Los `.AppImage` y `.deb` no necesitan firma.
