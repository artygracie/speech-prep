import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { colors, fonts, LOGO_URL, SITE_URL } from "./_brand";

interface BrandLayoutProps {
  preview: string;
  headline: ReactNode;
  intro?: ReactNode;
  ctaLabel: string;
  ctaUrl: string;
  fineprintLabel?: string;
  body?: ReactNode;
  footnote?: ReactNode;
}

export function BrandLayout({
  preview,
  headline,
  intro,
  ctaLabel,
  ctaUrl,
  fineprintLabel = "Or paste this into your browser:",
  body,
  footnote,
}: BrandLayoutProps) {
  return (
    <Html>
      <Head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Instrument+Serif:ital@0;1&display=swap"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={container}>
          <Section style={{ textAlign: "center", marginBottom: "32px" }}>
            <Img
              src={LOGO_URL}
              alt="SpeechPrep"
              width="150"
              height="22"
              style={{ margin: "0 auto", display: "block" }}
            />
          </Section>

          <Heading style={headlineStyle}>{headline}</Heading>

          {intro ? <Text style={introStyle}>{intro}</Text> : null}

          {body}

          <Section style={{ textAlign: "center", margin: "32px 0 8px 0" }}>
            <Button href={ctaUrl} style={ctaButton}>
              {ctaLabel}
            </Button>
          </Section>

          <Text style={fineprint}>
            {fineprintLabel}
            <br />
            <Link href={ctaUrl} style={fineprintLink}>
              {ctaUrl}
            </Link>
          </Text>

          {footnote ? (
            <>
              <Hr style={divider} />
              <Text style={footerText}>{footnote}</Text>
            </>
          ) : null}

          <Hr style={divider} />

          <Text style={signature}>— Gracie</Text>

          <Text style={footerSmall}>
            © 2026 SpeechPrep ·{" "}
            <Link href={SITE_URL} style={footerLink}>
              speechprep.ai
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ————————————————————————————————————————————————————————————————
// Styles — all inline so email clients render them.
// ————————————————————————————————————————————————————————————————

const bodyStyle = {
  backgroundColor: colors.background,
  fontFamily: fonts.sans,
  margin: 0,
  padding: "40px 20px",
};

const container = {
  maxWidth: "560px",
  margin: "0 auto",
  backgroundColor: colors.surface,
  borderRadius: "12px",
  padding: "48px 40px",
  border: `1px solid ${colors.border}`,
};

const headlineStyle = {
  fontFamily: fonts.sans,
  fontSize: "44px",
  fontWeight: 500,
  color: colors.ink,
  lineHeight: "1.04",
  letterSpacing: "-0.035em",
  margin: "0 0 24px 0",
  textAlign: "center" as const,
};

const introStyle = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: colors.ink,
  margin: "0 0 16px 0",
  textAlign: "center" as const,
};

const ctaButton = {
  backgroundColor: colors.ink,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 500,
  fontFamily: fonts.sans,
  padding: "14px 22px",
  borderRadius: "8px",
  textDecoration: "none",
  display: "inline-block",
  letterSpacing: "-0.005em",
};

const fineprint = {
  fontSize: "12px",
  lineHeight: "1.5",
  color: colors.muted,
  margin: "16px 0 0 0",
  textAlign: "center" as const,
  wordBreak: "break-all" as const,
};

const fineprintLink = {
  color: colors.muted,
  textDecoration: "underline",
};

const divider = {
  borderTop: `1px solid ${colors.border}`,
  margin: "32px 0 20px 0",
};

const footerText = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: colors.muted,
  margin: "0 0 16px 0",
  textAlign: "center" as const,
};

const signature = {
  fontFamily: fonts.serif,
  fontSize: "16px",
  fontStyle: "italic" as const,
  color: colors.ink,
  margin: "0 0 24px 0",
  textAlign: "center" as const,
};

const footerSmall = {
  fontSize: "12px",
  color: colors.muted,
  margin: "20px 0 0 0",
  textAlign: "center" as const,
};

const footerLink = {
  color: colors.muted,
  textDecoration: "underline",
};

// Re-exported for templates that want a smaller body paragraph style.
export const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: colors.muted,
  margin: "0 0 16px 0",
  textAlign: "center" as const,
};
