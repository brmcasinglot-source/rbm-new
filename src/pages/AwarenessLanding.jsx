import { useEffect } from "react";
import "../styles/Landing.css";
import logo from "../assets/logo.png";
import { useNavigate } from "react-router-dom";

const AwarenessLanding = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const items = document.querySelectorAll(".reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("active");
          }
        });
      },
      { threshold: 0.15 }
    );

    items.forEach((el) => {
      el.classList.add("reveal-hidden");
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing">

      {/* HERO */}
      <section className="hero">

        <div className="hero-bg"></div>
        <div className="hero-fade"></div>
        <img src={logo} className="hero-logo-mark" alt="" aria-hidden="true" />

        <div className="hero-inner reveal">

          {/* LOGO + SCHOOL NAME (SIDE BY SIDE) */}
          <div className="school-header">
            <img src={logo} className="logo" alt="CNHS Logo" />
            <span className="school">Casinglot National High School</span>
          </div>

          <h1 className="title">
            Bullying Reporting &amp; Management System
          </h1>

          <p className="subtitle italic-text">
            A safer school starts with speaking up.
          </p>

          <div className="actions">
            <button
              className="btn primary"
              onClick={() => navigate("/login")}
            >
              Login
            </button>

            <a href="#vision" className="learn-more-link">
              Learn more
            </a>
          </div>

          <div className="trust-strip">
            <span>100% Confidential</span>
            <span className="trust-divider" aria-hidden="true"></span>
            <span>We&apos;re here to help</span>
            <span className="trust-divider" aria-hidden="true"></span>
            <span>Takes 2 minutes</span>
          </div>

        </div>

        {/* SCROLL INDICATOR */}
        <div className="scroll">
          <p>Scroll</p>
          <span className="scroll-track">
            <span className="scroll-dot"></span>
          </span>
        </div>

      </section>

      {/* VISION & MISSION */}
      <section className="section purpose-section reveal" id="vision">
        <div className="purpose-inner">

          <div className="purpose-heading">
            <span className="eyebrow">What Drives Us</span>
            <h2>Our Commitment to a Safer School</h2>
          </div>

          <div className="purpose-columns">
            <div className="purpose-col">
              <span className="purpose-label">Vision</span>
              <p>
                A safe and supportive school environment where every learner feels protected, respected, and heard.
              </p>
            </div>

            <div className="purpose-divider" aria-hidden="true"></div>

            <div className="purpose-col">
              <span className="purpose-label">Mission</span>
              <p>
                To provide a secure digital reporting system that empowers students, strengthens accountability, and improves school safety.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* REASSURANCE */}
      <section className="section reveal reassure-section">
        <h2>You are never alone in this</h2>
        <p className="reassure-lead">
          Whether it happened to you or someone you care about, speaking up is a brave first step — and we&apos;ve made it as easy and safe as possible.
        </p>
        <div className="reassure-grid">
          <div className="reassure-card">
            <span className="reassure-index">01</span>
            <h4>Anonymous option</h4>
            <p>Submit without revealing your name if that feels safer.</p>
          </div>
          <div className="reassure-card">
            <span className="reassure-index">02</span>
            <h4>Track your case</h4>
            <p>See real-time updates on what&apos;s being done, every step.</p>
          </div>
          <div className="reassure-card">
            <span className="reassure-index">03</span>
            <h4>Kept confidential</h4>
            <p>Only authorized school personnel can ever view your report.</p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <img src={logo} alt="CNHS Logo" className="footer-logo" />
        <p>© 2026 Casinglot National High School</p>
        <p className="footer-tagline">A safer school starts with speaking up.</p>
      </footer>

    </div>
  );
};

export default AwarenessLanding;
