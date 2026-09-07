import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional


REPOSITORY = Path(__file__).resolve().parents[2]
PATCH_SITE = REPOSITORY / "scripts" / "patch-site.py"
ASSEMBLE_SITE = REPOSITORY / "scripts" / "assemble-site.py"
SYNC_SUPPORTED_VERSION = REPOSITORY / "scripts" / "sync-supported-version.py"


def write_build(builds: Path, version: str, product_version: Optional[str] = None) -> None:
    output = builds / version
    output.mkdir(parents=True)
    (output / "config.json").write_text(
        json.dumps({"productVersion": product_version or version})
    )
    (output / "overview.html").write_text(f"<html><title>{version}</title></html>")


class PatchSiteTests(unittest.TestCase):
    def test_sets_the_active_product_version_and_scoped_search_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "config.json").write_text(json.dumps({"productVersion": "latest"}))
            (site / "overview.html").write_text("<html><head></head><body></body></html>")

            subprocess.run(
                [
                    sys.executable,
                    PATCH_SITE,
                    site,
                    "v5.0",
                    "https://search.example.test/base/",
                ],
                check=True,
            )

            config = json.loads((site / "config.json").read_text())
            self.assertEqual(config["productVersion"], "v5.0")
            self.assertEqual(
                config["searchServiceUrl"],
                "https://search.example.test/base/preview-search/Writerside/d/v5.0",
            )


class AssembleSiteTests(unittest.TestCase):
    def run_assemble(self, root: Path, manifest_data: list[dict[str, object]]):
        builds = root / "builds"
        site = root / "site"
        manifest = root / "supported-versions.json"
        manifest.write_text(json.dumps(manifest_data))
        return subprocess.run(
            [sys.executable, ASSEMBLE_SITE, builds, site, manifest],
            cwd=root,
            capture_output=True,
            text=True,
        )

    def test_publishes_current_stable_then_rolling_latest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builds = root / "builds"
            write_build(builds, "v5.2")
            write_build(builds, "latest")

            result = self.run_assemble(
                root,
                [
                    {
                        "version": "v5.2",
                        "ref": "docs/v5.2",
                        "path": "/v5.2/",
                        "release": "v5.2.3",
                        "isCurrent": True,
                    },
                    {
                        "version": "latest",
                        "ref": "main",
                        "path": "/",
                        "isCurrent": False,
                    },
                ],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            versions = json.loads((root / "site" / "versions.json").read_text())
            self.assertEqual(
                versions,
                [
                    {"version": "v5.2", "url": "/v5.2/", "isCurrent": True},
                    {"version": "latest", "url": "/", "isCurrent": False},
                ],
            )

    def test_rejects_latest_before_an_older_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.run_assemble(
                root,
                [
                    {
                        "version": "latest",
                        "ref": "main",
                        "path": "/",
                        "isCurrent": False,
                    },
                    {
                        "version": "v5.2",
                        "ref": "docs/v5.2",
                        "path": "/v5.2/",
                        "isCurrent": True,
                    },
                ],
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("stable versions before", result.stderr)

    def test_rejects_a_build_with_the_wrong_active_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builds = root / "builds"
            write_build(builds, "v5.2", product_version="latest")
            write_build(builds, "latest")

            result = self.run_assemble(
                root,
                [
                    {
                        "version": "v5.2",
                        "ref": "docs/v5.2",
                        "path": "/v5.2/",
                        "isCurrent": True,
                    },
                    {
                        "version": "latest",
                        "ref": "main",
                        "path": "/",
                        "isCurrent": False,
                    },
                ],
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("declares productVersion 'latest'", result.stderr)


class SyncSupportedVersionTests(unittest.TestCase):
    def run_sync(self, root: Path, version: str):
        manifest = root / "supported-versions.json"
        return subprocess.run(
            [sys.executable, SYNC_SUPPORTED_VERSION, manifest, version],
            capture_output=True,
            text=True,
        )

    def test_derives_the_current_minor_from_the_published_patch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "supported-versions.json"
            manifest.write_text(
                json.dumps(
                    [
                        {
                            "version": "v5.0",
                            "ref": "docs/v5.0",
                            "path": "/v5.0/",
                            "isCurrent": True,
                        },
                        {
                            "version": "latest",
                            "ref": "main",
                            "path": "/",
                            "isCurrent": False,
                        },
                    ]
                )
            )

            result = self.run_sync(root, "5.2.3")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(manifest.read_text()),
                [
                    {
                        "version": "v5.2",
                        "ref": "docs/v5.2",
                        "path": "/v5.2/",
                        "release": "v5.2.3",
                        "isCurrent": True,
                    },
                    {
                        "version": "latest",
                        "ref": "main",
                        "path": "/",
                        "isCurrent": False,
                    },
                ],
            )
            output = json.loads(result.stdout)
            self.assertEqual(output["branch"], "docs/v5.2")
            self.assertTrue(output["changed"])

    def test_is_idempotent_for_the_same_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "supported-versions.json"
            manifest.write_text(
                json.dumps(
                    [
                        {
                            "version": "v5.2",
                            "ref": "docs/v5.2",
                            "path": "/v5.2/",
                            "release": "v5.2.3",
                            "isCurrent": True,
                        },
                        {
                            "version": "latest",
                            "ref": "main",
                            "path": "/",
                            "isCurrent": False,
                        },
                    ],
                    indent=2,
                )
                + "\n"
            )

            result = self.run_sync(root, "v5.2.3")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)["changed"])

    def test_rejects_prerelease_versions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "supported-versions.json").write_text("[]")

            result = self.run_sync(root, "5.3.0-beta.1")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("stable semantic version", result.stderr)


if __name__ == "__main__":
    unittest.main()
