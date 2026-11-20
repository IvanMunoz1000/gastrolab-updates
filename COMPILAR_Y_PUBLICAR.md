# GASTROLAB POS 1.2.2

## Cambios de esta versión

Facturas de Compras solo ofrece proveedores registrados. Una base vacía muestra el selector sin proveedores. Carta usa el ancho completo para administrar productos, promociones y combos. La comanda de Mesas y Pedidos sigue disponible.

## Publicar esta actualización

Con acceso al Firebase Hosting existente, integra la carpeta `publicacion/actualizaciones` del ZIP dentro de la carpeta pública del sitio. Copia también `GASTROLAB-1.2.2-x64.exe` junto a `actualizaciones/windows/latest.yml`. Si firmas o recompilas Windows, sustituye el EXE, el manifiesto y el blockmap por los de esa compilación.

Integra las cabeceras de `hosting-headers.example.json` en la configuración existente. Publica con `firebase deploy --only hosting --project northern-forge-7wpgt`. El plan Spark puede bloquear archivos EXE. Comprueba que el sitio permita alojar el instalador y que los manifiestos respondan 200.

Las instalaciones Windows y Android con actualizador compatible pueden descargar la versión desde el botón del POS. En 1.2.0 puede aparecer una confirmación de reinicio, porque esa versión ya instalada la solicita. Un instalador sin actualizador no puede iniciar este flujo.

## Antes de entregar a clientes

Control Ejecutivo admite tres establecimientos en total, incluida la Matriz. La instalación nueva pide el nombre comercial durante el alta del propietario y deja vacíos el RUC, la dirección y el eslogan. Actualizar una instalación existente conserva su identidad guardada. La confirmación de reinicio de las versiones anteriores se mostrará al actualizar desde ellas.

Esta compilación usa el proyecto y la base Firestore que identifica `firebase-applet-config.json`. No se efectuaron creaciones, borrados ni cambios en Firebase. Se quitó la carga automática de códigos de licencia y de ejemplos en Carta, Clientes, Proveedores, Menaje y WhatsApp. Se conservan los seis puestos de mesa iniciales y la prueba de 15 días como parte de la configuración operativa. Los botones manuales de demostración siguen disponibles en los módulos que ya los incluían. El alta del primer propietario genera los datos iniciales que la app necesita, incluida su prueba de 15 días.

El código permite un solo propietario por base y las reglas incluidas conceden acceso amplio a los usuarios autenticados. Antes de distribuir a negocios independientes, implementa aislamiento por negocio y reglas por rol o utiliza un Firebase dedicado por negocio y protege sus reglas antes de habilitar usuarios. Para usar otro Firebase, sustituye la configuración web del JSON y ajusta la URL de Windows en `electron-builder.yml`. Android deriva su servidor del `projectId`. Habilita Correo electrónico/Contraseña en Firebase Authentication y prueba el alta, reinicio, sincronización y actualización con datos de prueba en una base separada. La primera alta necesita Internet. Para pasar de la prueba a una licencia comercial, provisiona los códigos válidos en la colección de licencias desde un proceso administrativo con acceso restringido.

Se asignaron la versión 1.2.2 y el identificador de aplicación `com.gastrolab.pos`. Si ya distribuiste otra compilación, comprueba los identificadores, origen web y certificados anteriores. Cambiar estos valores puede crear otra instalación o dejar inaccesibles los datos locales previos. Las nuevas actualizaciones conservan el identificador, el origen local y el almacenamiento, pero se deben probar con la versión anterior antes de publicarlas. Evita limpiar datos o desinstalar para actualizar.

## Windows x64

Instala Node.js 24 LTS y ejecuta estos comandos desde la raíz del proyecto en Windows:

```powershell
npm ci
npm run lint
npm run build
npx electron-builder --win nsis --x64 --publish always
```

La carpeta `release/windows` contiene el instalador NSIS, el archivo `latest.yml` y el `.blockmap`. El proveedor generic genera los metadatos en local. El despliegue al alojamiento es manual. El EXE entregado está sin firma Authenticode. Para una versión comercial, configura tu certificado de firma y vuelve a compilar. Con un PFX, establece `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD` mediante variables de entorno seguras antes del último comando. Comprueba la firma con `Get-AuthenticodeSignature` y verifica que el editor de las futuras versiones sea el mismo.

## Android para celular y tablet

El mismo APK sirve para ambos. Requisitos de compilación: Node.js 24, JDK 21, Android SDK Platform 36 y Android Studio. Configura `JAVA_HOME` y `ANDROID_HOME` con las rutas locales. Desde la raíz, en Windows:

```powershell
npm ci
npm run build
npx cap sync android
Set-Location android
.\gradlew.bat :app:assembleDebug :app:assembleRelease
Set-Location ..
```

En macOS o Linux, sustituye las últimas tres líneas por `(cd android && ./gradlew :app:assembleDebug :app:assembleRelease)`.

Para clientes usa el APK release firmado con una clave bajo tu control. Si ya existe una clave de producción para el mismo identificador, reutilízala. El APK identificado como `PRUEBAS` usa una firma debug y sirve para validar la instalación en dispositivos de prueba. El APK identificado como `SIN-FIRMA` es la compilación release que debes firmar.

Para crear una clave nueva **solo si es el primer lanzamiento**, usa `keytool -genkeypair -v -keystore gastrolab-release.p12 -storetype PKCS12 -alias gastrolab -keyalg RSA -keysize 3072 -validity 10000`. Resguarda la clave y su contraseña fuera del proyecto. En Windows, con Android Build-Tools 35.0.0 instaladas, puedes firmar el binario suministrado desde la carpeta de descargas:

```powershell
$ToolsAndroid = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0'
& "$ToolsAndroid\zipalign.exe" -P 16 -f 4 GASTROLAB-1.2.2-Android-SIN-FIRMA.apk GASTROLAB-alineado.apk
& "$ToolsAndroid\apksigner.bat" sign --ks gastrolab-release.p12 --ks-key-alias gastrolab --out GASTROLAB-1.2.2-Android.apk GASTROLAB-alineado.apk
& "$ToolsAndroid\apksigner.bat" verify --verbose --print-certs GASTROLAB-1.2.2-Android.apk
```

Desde el proyecto, el APK sin firmar equivalente es `android/app/build/outputs/apk/release/app-release-unsigned.apk`. Para actualizaciones **nativas**, incrementa `versionCode` y `versionName` en `android/app/build.gradle`, compila y firma con la misma clave. El actualizador integrado de Android instala cambios de interfaz y lógica web. Los cambios de plugins, permisos o código nativo requieren otro APK firmado.

## iPhone y iPad

El ZIP incluye `ios/App/App.xcodeproj`, listo para abrir en Xcode con Swift Package Manager y el ícono de GASTROLAB. Usa macOS con Xcode 26 o posterior y una cuenta Apple Developer para distribución:

```bash
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

Selecciona tu equipo en **Signing & Capabilities**, registra un Bundle ID disponible si el actual no te pertenece, selecciona un dispositivo genérico de iOS y elige **Product → Archive**. Usa **Distribute App** para TestFlight o App Store. Las actualizaciones de iOS se entregan por el canal de Apple. El proyecto apunta a iPhone y iPad. En laptop Windows corresponde el EXE y en una Mac el APK/IPA no sustituye a un instalador macOS.

## Publicación del canal de actualizaciones

El botón **Buscar Actualizaciones** está en el menú lateral y en Configuración. Desde 1.2.1, el actualizador se activa al pulsarlo y reinicia automáticamente cuando termina la descarga. Se conserva el almacenamiento de la instalación. El servidor debe usar HTTPS y ser administrado por el propietario de GASTROLAB.

- Windows consulta `https://northern-forge-7wpgt.web.app/actualizaciones/windows/latest.yml`. Para cada actualización aumenta la versión en `package.json` con `npm version 1.2.3 --no-git-tag-version` (ajusta el número según corresponda), ejecuta la compilación y sube el EXE y su blockmap a `actualizaciones/windows/`. Publica `latest.yml` al final sin cambiar los nombres que contiene. El manifiesto incorpora el SHA-512.
- Android consulta `https://northern-forge-7wpgt.web.app/actualizaciones/android/1.2.0/latest.json` para el binario nativo anterior. Las versiones nativas 1.2.1 y 1.2.2 consultan sus rutas equivalentes. Para servir una actualización web posterior al binario 1.2.0, ejecuta `npm version 1.2.3 --no-git-tag-version` una sola vez, `npm run build` y `python scripts/bundle-android.py --native 1.2.0` (o `python3`, requiere Python 3.11+). Publica la carpeta `release/hosting/actualizaciones/android/1.2.0/` en la misma ruta del alojamiento. Sube primero el ZIP y al final `latest.json`. El actualizador compara las versiones y valida el SHA-256 del paquete. No publiques una compilación web que requiera plugins más nuevos en un canal nativo anterior.

Si usas Firebase Hosting, añade las reglas de `hosting-headers.example.json` a la configuración de Hosting existente, conserva sus archivos y reglas, y despliega los nuevos archivos dentro de la carpeta pública configurada allí. Con la CLI de Firebase autenticada en la cuenta propietaria, ejecuta `firebase deploy --only hosting --project northern-forge-7wpgt` desde **tu proyecto de Hosting existente** después de revisar el contenido completo del despliegue. Haz una prueba con una versión posterior antes del lanzamiento. La entrega incluye archivos para publicar. El alojamiento no se modificó.

En este ZIP, `publicacion/actualizaciones/` contiene el bundle 1.2.2 para las bases nativas 1.2.0, 1.2.1 y 1.2.2 de Android y los metadatos de Windows. Si publicas el EXE suministrado para un piloto, colócalo junto al manifiesto y al blockmap. Si vuelves a compilar o firmas el instalador, usa los metadatos de esa nueva compilación. El manifiesto debe coincidir con los bytes del EXE publicado.
