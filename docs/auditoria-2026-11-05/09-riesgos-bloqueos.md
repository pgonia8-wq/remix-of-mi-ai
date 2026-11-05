# Riesgos residuales y bloqueos

- Dispositivo/APK instalado inaccesibles: para certificar Android se requiere APK concreto con hash/versión y ejecutar checklist físico, idealmente pruebas en emulador más teléfono Motorola. No pedir claves.
- Proveedores reales no probados: se necesita autorización de operaciones/modelos y tope de gasto; las credenciales permanecen en dispositivo. No inventar disponibilidad TPM efectiva a partir de 429; Fer declara 1M TPM por deployment, Azure debe comprobarse con métricas de ese deployment cuando esté autorizado.
- PC Windows/macOS, VM, SSH y Demucs reales sin sesiones/pesos verificables: pruebas locales no certifican plataformas.
- No artefactos actuales en checkout ni android/ generado. Firma/release/instalación no verificados; no comparar APK instalada con código sin binario.
- Deep scanner informó **incomplete** aunque terminó el trabajo; falta cobertura completa. No problemas en scan anterior no significa código seguro. Avisos de dependencia actuales contradicen una conclusión global de “sin vulnerabilidades”.
- Sin revisión completa de rendimiento/batería/memoria/disco lleno, accesibilidad, todos formularios, orientación o política vigente Play. No inferir requisitos oficiales por memoria; comprobar fuentes oficiales antes de implementar.
- PWA/suscripciones pendientes fuera de esta auditoría; esta web es preview y almacén no apto para producto web comercial según arquitectura actual.
- Branch/restore externo no generado: plataforma administra Git. Baseline de commit/hashes conservado; hacer copia independiente excluyendo secretos antes de futuras correcciones.
- Pistas históricas no reproducidas en datos reales: no hay acceso a runs, catálogo o configuración del teléfono de Fer.
