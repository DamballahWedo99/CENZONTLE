export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <img
            src="/Imagotipo.svg"
            alt="CENZONTLE"
            className="mx-auto h-16 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight">CENZONTLE</h1>
          <p className="text-sm text-muted-foreground">
            Software Factory &amp; Project Management
          </p>
        </div>
        <a
          href="/auth/login"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Iniciar sesion
        </a>
      </div>
    </div>
  );
}
