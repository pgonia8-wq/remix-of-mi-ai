# Code sandboxes
- JavaScript/TypeScript runs only in a separate worker using QuickJS WASM (TS transpiled with sucrase) with no host objects/modules and bounded memory, stack, time and output. Why: generated code must not reach storage, network or credentials.
- Python runs only in a separate Pyodide worker shipped in public/pyodide; packages the code imports load from local files first, then network/storage globals are deleted, and the worker is terminated on timeout. Input files go to /in and results come back from /out, both bounded. Why: same isolation, with useful outputs.
- Scientific wheels (numpy, pandas, matplotlib, scipy and dependencies) are gitignored and fetched sha256-checked by scripts/fetch-pyodide-packages.py from android-prepare.sh. Why: some exceed the repository file-size limit, yet the APK must work offline.
- No eval in the application or the native shell bridge.
