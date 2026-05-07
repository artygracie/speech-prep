import { Text } from "@react-email/components";
import { BrandLayout, paragraph } from "./_layout";

export default function MagicLink() {
  return (
    <BrandLayout
      preview="Your sign-in link for SpeechPrep."
      headline={
        <>
          sign <span style={{ fontStyle: "italic", fontWeight: 400 }}>in</span>.
        </>
      }
      intro="Hey,"
      ctaLabel="Sign in to SpeechPrep"
      ctaUrl="{{ .ConfirmationURL }}"
      body={
        <Text style={paragraph}>
          Click the button below to sign in. The link is good for one use and
          expires shortly.
        </Text>
      }
      footnote="If you didn't ask to sign in, you can ignore this email — nothing will happen."
    />
  );
}
