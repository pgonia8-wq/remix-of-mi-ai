import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Pending = { spentUsd: number; limitUsd: number; resolve: (ok: boolean) => void };

/** App-styled, one-call over-budget confirmation. Each request resolves exactly once; closing counts as "no". */
export function BudgetConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/core/costs").then(({ setBudgetHooks }) => {
      if (!alive) return;
      setBudgetHooks({
        warn: ({ spentUsd, limitUsd }) => { void import("sonner").then(({ toast }) => toast.warning(`Llevas US$ ${spentUsd.toFixed(2)} de ${limitUsd.toFixed(2)} del presupuesto mensual de este proyecto.`)); },
        confirmOverBudget: (info) => new Promise<boolean>((resolve) => setPending((prev) => { prev?.resolve(false); return { ...info, resolve }; })),
      });
    });
    return () => { alive = false; };
  }, []);
  const answer = (ok: boolean) => { pending?.resolve(ok); setPending(null); };
  return (
    <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) answer(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Presupuesto mensual superado</AlertDialogTitle>
          <AlertDialogDescription>
            Este proyecto lleva US$ {pending?.spentUsd.toFixed(2)} de US$ {pending?.limitUsd.toFixed(2)}. Puedes permitir solo esta llamada; las siguientes volverán a pedir confirmación.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>No hacerla</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>Hacer solo esta llamada</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
