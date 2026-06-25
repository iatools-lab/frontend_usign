import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Mail, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api";
import { resendEmailVerification, verifyEmail } from "@/lib/auth";

const searchSchema = z.object({
  token: z.string().optional(),
  email: z.string().optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Vérification email — Usign" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token, email, redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"waiting" | "verifying" | "verified" | "failed">(
    token ? "verifying" : "waiting",
  );
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void verifyEmail(token)
      .then(() => {
        if (!active) return;
        setStatus("verified");
        window.setTimeout(() => {
          if (redirect?.startsWith("/")) {
            window.location.assign(redirect);
          } else {
            navigate({ to: "/" });
          }
        }, 700);
      })
      .catch(() => {
        if (active) setStatus("failed");
      });
    return () => {
      active = false;
    };
  }, [navigate, redirect, token]);

  const resend = async () => {
    if (!email || isResending) return;
    setIsResending(true);
    try {
      await resendEmailVerification(email, redirect);
      toast.success("Un nouveau lien de vérification a été envoyé.");
      setStatus("waiting");
    } catch (error) {
      toast.error(getErrorMessage(error, "Envoi impossible"));
    } finally {
      setIsResending(false);
    }
  };

  const icon =
    status === "verified" ? (
      <CheckCircle2 className="h-12 w-12 text-emerald-600" />
    ) : status === "failed" ? (
      <XCircle className="h-12 w-12 text-destructive" />
    ) : (
      <Mail className="h-12 w-12 text-action" />
    );

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <Logo size="sm" className="mx-auto mb-8 justify-center" />
        <div className="mx-auto mb-4 flex justify-center">{icon}</div>
        <h1 className="text-xl font-semibold text-foreground">
          {status === "verified"
            ? "Adresse vérifiée"
            : status === "failed"
              ? "Lien invalide ou expiré"
              : status === "verifying"
                ? "Vérification en cours…"
                : "Vérifiez votre boîte email"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "waiting" && email
            ? `Nous avons envoyé un lien d’activation à ${email}.`
            : status === "verified"
              ? "Votre compte est activé. Redirection en cours…"
              : status === "failed"
                ? "Demandez un nouveau lien pour activer votre compte."
                : "Merci de patienter."}
        </p>
        {(status === "waiting" || status === "failed") && email ? (
          <Button onClick={resend} disabled={isResending} variant="outline" className="mt-6">
            <RefreshCw className="mr-2 h-4 w-4" />
            {isResending ? "Envoi…" : "Renvoyer le lien"}
          </Button>
        ) : null}
        <div className="mt-6">
          <Link
            to="/login"
            search={{ email, redirect }}
            className="text-sm text-action hover:underline"
          >
            Retour à la connexion
          </Link>
        </div>
      </section>
    </main>
  );
}
