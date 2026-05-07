import { Text } from "@react-email/components";
import { BrandLayout, paragraph } from "./_layout";

export default function ChangeEmail() {
  return (
    <BrandLayout
      preview="Confirm your new email address for SpeechPrep."
      headline={
        <>
          confirm your <span style={{ fontStyle: "italic", fontWeight: 400 }}>new email</span>.
        </>
      }
      intro="Hey,"
      ctaLabel="Confirm new email"
      ctaUrl="{{ .ConfirmationURL }}"
      body={
        <Text style={paragraph}>
          You asked to change the email on your SpeechPrep account from{" "}
          <strong style={{ color: "#111111" }}>{"{{ .Email }}"}</strong> to{" "}
          <strong style={{ color: "#111111" }}>{"{{ .NewEmail }}"}</strong>.
          Click below to confirm the change.
        </Text>
      }
      footnote="If you didn't request this change, ignore this email and your address will stay the same."
    />
  );
}
