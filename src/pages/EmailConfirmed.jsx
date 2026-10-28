import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import logo from "../assets/logo.png";
import cnhs from "../assets/cnhs.jpg";
import "../styles/Login.css";
import { finalizeEmailConfirmation } from "../lib/auth.js";
import { supabase } from "../lib/supabaseClient.js";

// Landed on directly from the "Confirm email address" link in the sign-up
// Gmail (see emailRedirectTo in signUpStudent). supabase-js parses that
// link's tokens out of the URL and turns them into a live session
// asynchronously — calling getUser() immediately on mount can race ahead of
// that and find no session yet, so instead this waits for the SIGNED_IN
// event supabase-js fires once the session is actually ready. Once it does,
// finalizeEmailConfirmation() uses that brief session to create the
// students-table profile row right away (so the account shows up in the
// admin's Account Confirmations queue immediately instead of only after the
// student's first login attempt), then signs the raw session back out.
export default function EmailConfirmed() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(!supabase);
  const done = useRef(false);

  useEffect(() => {
    if (!supabase) return;

    const finish = (user) => {
      if (done.current) return;
      done.current = true;
      finalizeEmailConfirmation(user).finally(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setReady(true);
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) finish(session.user);
    });

    // Covers the rare case where the session was already established by the
    // time this listener attached (event fired just before we subscribed).
    supabase.auth.getUser().then(({ data }) => { if (data.user) finish(data.user); });

    // Safety net: if the link is already used/expired and no session ever
    // shows up, don't leave the button disabled forever.
    const timeoutId = setTimeout(() => setReady(true), 4000);

    return () => { subscription.unsubscribe(); clearTimeout(timeoutId); };
  }, []);

  return (
    <div className="login-page">
      <div
        className="login-left-panel"
        style={{ backgroundImage: `url(${cnhs})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="left-content">
          <div className="logo-box">
            <img src={logo} alt="CNHS Logo" />
          </div>
          <h2>CASINGLOT NATIONAL HIGH SCHOOL</h2>
          <h3>Bullying Reporting &amp; Management System</h3>
          <p className="tagline">A safer school starts with speaking up.</p>
        </div>
      </div>

      <div className="login-right-panel">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div
            style={{
              width: 72, height: 72, margin: "0 auto 20px", borderRadius: "50%",
              background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <CheckCircle2 size={40} color="#16a34a" />
          </div>

          <h2>{supabase ? "You're confirmed!" : "Email confirmation unavailable"}</h2>
          <p className="login-sub" style={{ marginBottom: 28 }}>
            {supabase
              ? "Your email address has been verified. An admin still needs to approve your account before you can log in — you'll be able to sign in once that happens."
              : "Supabase is not configured for this deployment. Email confirmation requires a Supabase connection."}
          </p>

          <button
            className="login-btn"
            type="button"
            disabled={!ready}
            onClick={() => navigate("/login")}
          >
            Go to Login
          </button>
        </div>
      </div>
    </div>
  );
}
