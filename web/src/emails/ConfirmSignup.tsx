import { Text } from "@react-email/components";
import { BrandLayout, paragraph } from "./_layout";

export default function ConfirmSignup() {
  return (
    <BrandLayout
      preview="Confirm your email to start practicing on SpeechPrep."
      headline={
        <>
          welcome to <span style={{ fontStyle: "italic", fontWeight: 400 }}>SpeechPrep</span>.
        </>
      }
      intro="Hey,"
      ctaLabel="Confirm my email"
      ctaUrl="{{ .ConfirmationURL }}"
      body={
        <Text style={paragraph}>
          One quick step to get you in: confirm the email address on your
          account so we can save your sessions and send you reports.
        </Text>
      }
      footnote="If you didn't sign up for SpeechPrep, you can safely ignore this email."
    />
  );
}
