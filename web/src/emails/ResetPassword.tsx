import { Text } from "@react-email/components";
import { BrandLayout, paragraph } from "./_layout";

export default function ResetPassword() {
  return (
    <BrandLayout
      preview="Reset your SpeechPrep password."
      headline={
        <>
          reset your <span style={{ fontStyle: "italic", fontWeight: 400 }}>password</span>.
        </>
      }
      intro="Hey,"
      ctaLabel="Reset password"
      ctaUrl="{{ .ConfirmationURL }}"
      body={
        <Text style={paragraph}>
          We got a request to reset the password on your SpeechPrep account.
          Click below to choose a new one. This link expires shortly.
        </Text>
      }
      footnote="If you didn't ask for a password reset, you can ignore this email — your current password will keep working."
    />
  );
}
