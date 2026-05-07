import { Text } from "@react-email/components";
import { BrandLayout, paragraph } from "./_layout";

export default function InviteUser() {
  return (
    <BrandLayout
      preview="You've been invited to SpeechPrep."
      headline={
        <>
          you&apos;re <span style={{ fontStyle: "italic", fontWeight: 400 }}>invited</span>.
        </>
      }
      intro="Hey,"
      ctaLabel="Accept invite"
      ctaUrl="{{ .ConfirmationURL }}"
      body={
        <Text style={paragraph}>
          You&apos;ve been invited to join SpeechPrep — an AI rehearsal tool for
          prepared speech. Click below to set up your account and start
          practicing.
        </Text>
      }
      footnote="If you weren't expecting this invite, you can ignore this email."
    />
  );
}
