// The list of days, as a page.
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { Gallery } from "@/shared/ui/Gallery";

createRoot(document.querySelector(".cv-root")!).render(<Gallery />);
