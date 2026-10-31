// No browser/Node objects, network, filesystem, module loader, or credentials are bridged into QuickJS.
export const CODE_LIMITS = { memory: 16 * 1024 * 1024, stack: 256 * 1024, time: 1500, source: 60_000, output: 16_000 };
export type CodeResult = { ok: boolean; output: string; error?: string };
export async function evaluateCode(source: string, input = "", time = CODE_LIMITS.time): Promise<CodeResult> {
  if (source.length > CODE_LIMITS.source) throw new Error("Código demasiado grande (máximo 60 000 caracteres).");
  const [{ newQuickJSWASMModuleFromVariant }, { default: variant }] = await Promise.all([
    import("quickjs-emscripten-core"), import("@jitl/quickjs-singlefile-cjs-release-sync"),
  ]);
  const engine = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(CODE_LIMITS.memory);
  runtime.setMaxStackSize(CODE_LIMITS.stack);
  const deadline = Date.now() + Math.min(CODE_LIMITS.time, Math.max(1, time));
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  const logs: string[] = [];
  let total = 0;
  try {
    const value = vm.newString(input.slice(0, CODE_LIMITS.source));
    vm.setProp(vm.global, "input", value); value.dispose();
    const log = vm.newFunction("print", (...args) => {
      const line = args.map((h) => { const v: unknown = vm.dump(h); return typeof v === "string" ? v : JSON.stringify(v); }).join(" ");
      total += line.length + 1;
      if (total > CODE_LIMITS.output) throw new Error("Límite de salida alcanzado.");
      logs.push(line);
    });
    vm.setProp(vm.global, "print", log); log.dispose();
    const result = vm.evalCode(`const console = Object.freeze({log: print});\n${source}`, "script.js");
    if (result.error) {
      const e: unknown = vm.dump(result.error); result.error.dispose();
      const error = Date.now() >= deadline ? "Tiempo de ejecución agotado." : JSON.stringify(e).slice(0, CODE_LIMITS.output);
      return { ok: false, output: logs.join("\n"), error };
    }
    const final: unknown = vm.dump(result.value); result.value.dispose();
    if (final !== undefined) logs.push(typeof final === "string" ? final : JSON.stringify(final));
    return { ok: true, output: logs.join("\n").slice(0, CODE_LIMITS.output) };
  } finally { vm.dispose(); runtime.dispose(); }
}