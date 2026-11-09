const IDENTITY_PACKAGE_NAME: &str = "site.howlil.otto";
const IDENTITY_APPLICATION_ID: &str = "Otto";

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn identity_manifest(publisher: &str) -> String {
    let publisher = escape_xml(publisher);
    format!(
        r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="0.0.0.0" name="{IDENTITY_PACKAGE_NAME}" />
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1" publisher="{publisher}" packageName="{IDENTITY_PACKAGE_NAME}" applicationId="{IDENTITY_APPLICATION_ID}" />
</assembly>"#
    )
}

fn main() {
    println!("cargo:rerun-if-env-changed=OTTO_MSIX_PUBLISHER");

    let attributes = std::env::var("OTTO_MSIX_PUBLISHER")
        .ok()
        .filter(|publisher| !publisher.trim().is_empty())
        .map(|publisher| {
            tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new().app_manifest(identity_manifest(&publisher)),
            )
        })
        .unwrap_or_default();

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
