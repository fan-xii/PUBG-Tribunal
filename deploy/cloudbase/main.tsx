import { createRoot } from "react-dom/client";
import VoteApp from "../../app/vote-app";
import "../../app/vote.css";

createRoot(document.getElementById("root")!).render(<VoteApp economyPolling />);
