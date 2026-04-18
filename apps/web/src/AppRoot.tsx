import { Toaster } from "sonner";
import App from "./App";
import { useTheme } from "./lib/theme";

export function AppRoot() {
  const { resolved } = useTheme();
  return (
    <>
      <App />
      <Toaster richColors closeButton position="top-center" theme={resolved} />
    </>
  );
}
