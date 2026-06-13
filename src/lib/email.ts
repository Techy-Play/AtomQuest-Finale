import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

interface InviteEmailOptions {
  to: string;
  agentName: string;
  sessionTitle: string;
  joinUrl: string;
  customerName?: string;
}

export async function sendInviteEmail({ to, agentName, sessionTitle, joinUrl, customerName }: InviteEmailOptions) {
  const greeting = customerName ? `Hello ${customerName},` : 'Hello,';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ConnectDesk — You've been invited</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; font-family: 'Inter', -apple-system, sans-serif; color: #e2e8f0; }
  </style>
</head>
<body style="background:#0a0a0f; padding: 40px 16px;">
  <div style="max-width:560px; margin:0 auto;">

    <!-- Header -->
    <div style="text-align:center; margin-bottom:32px;">
      <div style="display:inline-flex; align-items:center; gap:12px; background:rgba(99,102,241,0.12); border:1px solid rgba(99,102,241,0.25); border-radius:16px; padding:12px 20px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2">
          <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
        </svg>
        <span style="font-size:20px; font-weight:700; background:linear-gradient(135deg,#818cf8,#a78bfa); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">ConnectDesk</span>
      </div>
    </div>

    <!-- Card -->
    <div style="background:#111118; border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden;">

      <!-- Gradient top bar -->
      <div style="height:3px; background:linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa);"></div>

      <div style="padding:40px 36px;">

        <!-- Icon -->
        <div style="width:64px; height:64px; background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); border-radius:16px; display:flex; align-items:center; justify-content:center; margin-bottom:24px;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="1.8">
            <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
          </svg>
        </div>

        <p style="color:#94a3b8; font-size:14px; margin-bottom:8px;">${greeting}</p>
        <h1 style="font-size:26px; font-weight:700; color:#f1f5f9; line-height:1.3; margin-bottom:12px;">
          You've been invited to a<br/>video support session
        </h1>
        <p style="color:#64748b; font-size:15px; line-height:1.6; margin-bottom:24px;">
          <strong style="color:#94a3b8;">${agentName}</strong> has created a support session for you on ConnectDesk. 
          Join the call directly from your browser — no downloads or plugins required.
        </p>

        <!-- Session info -->
        <div style="background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.15); border-radius:12px; padding:20px; margin-bottom:28px;">
          <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#6366f1; font-weight:600; margin-bottom:6px;">Session</p>
          <p style="font-size:16px; font-weight:600; color:#e2e8f0;">${sessionTitle}</p>
          <div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
            <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#6366f1; font-weight:600; margin-bottom:6px;">Hosted by</p>
            <p style="font-size:14px; color:#94a3b8;">${agentName}</p>
          </div>
        </div>

        <!-- CTA Button -->
        <a href="${joinUrl}" 
           style="display:block; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#ffffff; text-decoration:none; text-align:center; padding:16px 32px; border-radius:12px; font-size:16px; font-weight:600; letter-spacing:0.01em; margin-bottom:20px;">
          🎥&nbsp;&nbsp;Join Video Support Session
        </a>

        <!-- Link fallback -->
        <p style="font-size:12px; color:#475569; text-align:center; line-height:1.6;">
          Or paste this link into your browser:<br/>
          <a href="${joinUrl}" style="color:#818cf8; word-break:break-all;">${joinUrl}</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#0d0d14; border-top:1px solid rgba(255,255,255,0.05); padding:20px 36px; text-align:center;">
        <p style="font-size:12px; color:#334155; line-height:1.6;">
          This invite was sent by ${agentName} via ConnectDesk.<br/>
          If you weren't expecting this email, you can safely ignore it.
        </p>
      </div>

    </div>

    <!-- Bottom brand -->
    <p style="text-align:center; margin-top:24px; font-size:11px; color:#1e293b;">
      Powered by <strong style="color:#4338ca;">ConnectDesk</strong> — Real-Time Video Support
    </p>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: `"ConnectDesk" <${process.env.EMAIL_USER}>`,
    to,
    subject: `${agentName} has invited you to a support video call`,
    text: `${greeting}\n\n${agentName} has invited you to a support session: "${sessionTitle}".\n\nJoin here: ${joinUrl}\n\nNo downloads needed — join directly from your browser.`,
    html,
  });
}
