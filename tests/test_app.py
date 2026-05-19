import json
import tempfile
import unittest
from pathlib import Path

import app as stage_app


class StagebuilderApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        stage_app.DB_PATH = Path(self.tmp.name) / "test.sqlite3"
        stage_app.init_db()
        stage_app.app.config.update(TESTING=True)
        self.client = stage_app.app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    def create_range(self):
        payload = {
            "name": "Testkeller 25m",
            "description": "Keller mit Umlauten äöü",
            "widthM": 8,
            "heightM": 25,
            "gridM": 1,
            "pixelsPerMeter": 32,
            "boundaryBackstops": [
                *[{"side": "top", "meterIndex": i, "active": True} for i in range(8)],
                *[{"side": "right", "meterIndex": i, "active": True} for i in range(4)],
            ],
            "notes": "Nur legale Trainingsplanung",
        }
        response = self.client.post("/api/ranges", json=payload)
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def stage_payload(self, range_id, weapon="kurzwaffe", training_type="statisch", focus=None):
        return {
            "rangeId": range_id,
            "name": "Umlaut Stage äöü",
            "description": "Kurz",
            "trainingGoal": "Präzision",
            "procedure": "Ablauf",
            "safetyNotes": "Sicherheit",
            "trainingType": training_type,
            "weaponType": weapon,
            "startPositionHandgun": "Holster",
            "startPositionLongGun": "hängend am Sling",
            "focusAreas": focus or [],
            "ammo": {"autoCalculate": False, "roundsPerRun": 15, "runs": 4, "manualAmmoNote": "3 volle Magazine"},
            "magPrep": {
                "handgun": {
                    "magazineCount": 3,
                    "magazines": [
                        {"name": "Magazin 1", "state": "voll", "rounds": None},
                        {"name": "Magazin 2", "state": "anzahl", "rounds": 8},
                        {"name": "Magazin 3", "state": "leer", "rounds": None},
                    ],
                },
                "longGun": {
                    "magazineCount": 2,
                    "magazines": [
                        {"name": "Magazin 1", "state": "voll", "rounds": None},
                        {"name": "Magazin 2", "state": "anzahl", "rounds": 10},
                    ],
                },
            },
            "objects": [
                {"type": "target", "xM": 1, "yM": 5, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {}},
                {"type": "target", "xM": 2, "yM": 5, "widthM": .55, "heightM": .95, "rotation": 0, "label": "NS", "properties": {"targetVariant": "no-shoot"}},
                {"type": "cone", "xM": 3, "yM": 6, "widthM": .3, "heightM": .4, "rotation": 0, "label": "", "properties": {}},
                {"type": "barricade", "xM": 4, "yM": 7, "widthM": 1.2, "heightM": .35, "rotation": 15, "label": "", "properties": {}},
                {"type": "light", "xM": 5, "yM": 8, "widthM": .4, "heightM": .4, "rotation": 0, "label": "", "properties": {}},
                {"type": "start", "xM": 1, "yM": 8, "widthM": .75, "heightM": .75, "rotation": 0, "label": "", "properties": {}},
                {"type": "backstop", "xM": 2, "yM": 8, "widthM": 1.4, "heightM": .55, "rotation": 0, "label": "", "properties": {}},
                {"type": "arrow", "xM": 4, "yM": 9, "widthM": .7, "heightM": .28, "rotation": 45, "label": "", "properties": {}},
            ],
        }

    def target_objects(self, count):
        return [
            {"type": "target", "xM": i % 4 + 1, "yM": i // 4 + 5, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {}}
            for i in range(count)
        ]

    def backstop_objects(self, count):
        return [
            {"type": "backstop", "xM": i + 1, "yM": 8, "widthM": 1.4, "heightM": .55, "rotation": 0, "label": "", "properties": {}}
            for i in range(count)
        ]

    def test_range_stage_magazines_difficulty_json_pdf(self):
        range_data = self.create_range()
        self.assertEqual(len(range_data["boundaryBackstops"]), 12)

        ranges = self.client.get("/api/ranges").get_json()
        self.assertEqual(ranges[0]["boundaryBackstops"][0]["side"], "top")

        object_stage = self.stage_payload(range_data["id"])
        response = self.client.post("/api/stages", json=object_stage)
        self.assertEqual(response.status_code, 201)
        stage = response.get_json()
        self.assertEqual(stage["ammo"]["roundsPerShooterTotal"], 60)
        self.assertEqual(stage["magPrep"]["handgun"]["magazines"][1]["rounds"], 8)
        self.assertEqual(stage["difficultyCalculated"], "Mittel")

        loaded = self.client.get(f"/api/stages/{stage['id']}").get_json()
        self.assertEqual(len(loaded["range"]["boundaryBackstops"]), 12)
        self.assertEqual(loaded["stage"]["objects"][0]["type"], "target")

        simple = self.stage_payload(range_data["id"])
        simple["objects"] = self.target_objects(2)
        response = self.client.post("/api/stages", json=simple)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Leicht")

        dynamic = self.stage_payload(range_data["id"], training_type="dynamisch")
        response = self.client.post("/api/stages", json=dynamic)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Mittel")

        hard = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch", focus=["Team"])
        response = self.client.post("/api/stages", json=hard)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Schwer")

        exported = self.client.get(f"/api/stages/{stage['id']}/export.json")
        self.assertEqual(exported.status_code, 200)
        payload = json.loads(exported.data.decode("utf-8"))
        self.assertEqual(payload["stage"]["name"], "Umlaut Stage äöü")

        imported = self.client.post("/api/import", json=payload)
        self.assertEqual(imported.status_code, 201)

        pdf = self.client.get(f"/api/stages/{stage['id']}/pdf")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.mimetype, "application/pdf")
        self.assertTrue(pdf.data.startswith(b"%PDF"))
        pdf_text = pdf.data.decode("latin1", errors="ignore")
        self.assertIn("Munition", pdf_text)
        self.assertIn("Schwierigkeit", pdf_text)
        self.assertIn("Start Kurzwaffe", pdf_text)
        self.assertNotIn("Start Langwaffe", pdf_text)
        self.assertNotIn("Schwerpunkte", pdf_text)
        self.assertNotIn("Notizfeld Author", pdf_text)
        self.assertIn("25 m", pdf_text)

    def test_symbol_contract_and_range_recreate_after_delete_all(self):
        symbols = json.loads((Path(stage_app.BASE_DIR) / "static/symbols.json").read_text(encoding="utf-8"))
        self.assertGreater(symbols["objects"]["target"]["widthM"], 0)
        self.assertGreaterEqual(symbols["objects"]["target"]["heightM"] / symbols["objects"]["target"]["widthM"], 1.5)
        self.assertLessEqual(symbols["objects"]["target"]["heightM"] / symbols["objects"]["target"]["widthM"], 2.0)
        self.assertEqual(symbols["objects"]["cone"]["visualWidthPx"], 14)
        self.assertEqual(symbols["objects"]["arrow"]["visualWidthPx"], 20)
        self.assertTrue(symbols["objects"]["cone"]["fixedVisual"])
        self.assertTrue(symbols["objects"]["arrow"]["fixedVisual"])
        self.assertLess(symbols["objects"]["arrow"]["widthM"], 1.0)
        self.assertLess(symbols["objects"]["cone"]["widthM"], 0.4)
        self.assertEqual(stage_app.SYMBOL_THEME["start"]["fill"], "#67e8f9")
        self.assertEqual(stage_app.SYMBOL_THEME["backstop"]["fill"], "#7f1d1d")

        js = (Path(stage_app.BASE_DIR) / "static/js/app.js").read_text(encoding="utf-8")
        self.assertIn('"stroke-width": .04', js)

        first = self.create_range()
        second = self.client.post("/api/ranges", json={"name": "Zweiter", "widthM": 8, "heightM": 25}).get_json()
        self.assertEqual(self.client.delete(f"/api/ranges/{first['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/ranges/{second['id']}").status_code, 200)
        self.assertEqual(self.client.get("/api/ranges").get_json(), [])

        created = self.client.post("/api/ranges", json={"name": "Direkt neu", "widthM": 10, "heightM": 20})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["name"], "Direkt neu")

    def test_auto_ammo_counts_only_targets_and_render_order_keeps_targets_on_top(self):
        range_data = self.create_range()
        payload = self.stage_payload(range_data["id"])
        payload["ammo"] = {"autoCalculate": True, "roundsPerTarget": 2, "runs": 2}
        payload["objects"] = [
            {"type": "backstop", "xM": 1, "yM": 5, "widthM": 2, "heightM": 1, "rotation": 0, "label": "", "properties": {}},
            *[
                {"type": "target", "xM": i % 4 + 1, "yM": i // 4 + 6, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {}}
                for i in range(8)
            ],
            *[
                {"type": "target", "xM": i + 1, "yM": 9, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {"targetVariant": "no-shoot"}}
                for i in range(3)
            ],
        ]
        response = self.client.post("/api/stages", json=payload)
        self.assertEqual(response.status_code, 201)
        stage = response.get_json()
        self.assertEqual(stage["ammo"]["targetCount"], 8)
        self.assertEqual(stage["ammo"]["roundsPerRun"], 16)
        self.assertEqual(stage["ammo"]["roundsPerShooterTotal"], 32)
        pdf = self.client.get(f"/api/stages/{stage['id']}/pdf")
        pdf_text = pdf.data.decode("latin1", errors="ignore")
        self.assertIn("Scheiben", pdf_text)

        ordered = [obj["type"] for _, obj in stage_app.sorted_stage_objects(payload["objects"])]
        self.assertLess(ordered.index("backstop"), ordered.index("target"))
        self.assertGreaterEqual(ordered.count("target"), 1)

        manual = self.stage_payload(range_data["id"])
        manual["ammo"] = {"autoCalculate": False, "roundsPerRun": 15, "runs": 4}
        response = self.client.post("/api/stages", json=manual)
        self.assertEqual(response.get_json()["ammo"]["roundsPerShooterTotal"], 60)

    def test_pdf_object_geometry_keeps_rotated_backstop_and_target_inside_stage(self):
        range_data = self.create_range()
        stage = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        stage["objects"] = [
            {"type": "backstop", "xM": 6.1, "yM": 12, "widthM": 1.4, "heightM": .55, "rotation": 15, "label": "", "properties": {}},
            {"type": "target", "xM": 6.45, "yM": 11.9, "widthM": .55, "heightM": .95, "rotation": -15, "label": "", "properties": {}},
        ]
        drawing, _ = stage_app.stage_drawing(stage, range_data, 130 * stage_app.mm, 119 * stage_app.mm)
        width_m = float(range_data["widthM"])
        height_m = float(range_data["heightM"])
        scale = min((130 * stage_app.mm) / width_m, (119 * stage_app.mm) / height_m)
        draw_w = width_m * scale
        draw_h = height_m * scale
        ox = ((130 * stage_app.mm) - draw_w) / 2
        oy = (119 * stage_app.mm) - draw_h

        groups = [item for item in drawing.contents if item.__class__.__name__ == "Group"]
        self.assertEqual(len(groups), 2)
        for group in groups:
            center_x = group.transform[4]
            center_y = group.transform[5]
            self.assertGreaterEqual(center_x, ox)
            self.assertLessEqual(center_x, ox + draw_w)
            self.assertGreaterEqual(center_y, oy)
            self.assertLessEqual(center_y, oy + draw_h)

        backstop_geom = stage_app.get_object_geometry(stage["objects"][0], scale, ox, 0, range_data["pixelsPerMeter"])
        expected_backstop_y = stage_app.pdf_y_from_stage_top(oy, draw_h, backstop_geom["centerY"])
        self.assertAlmostEqual(groups[0].transform[4], backstop_geom["centerX"], places=4)
        self.assertAlmostEqual(groups[0].transform[5], expected_backstop_y, places=4)
        self.assertLess(groups[0].transform[1], 0)

    def test_difficulty_settings_and_pdf_branding_footer(self):
        settings = self.client.put(
            "/api/settings",
            json={"authorName": "Jannis", "customFooterText": "Internal Training Use Only", "defaultVersion": "v2.0"},
        )
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.get_json()["authorName"], "Jannis")
        self.assertEqual(settings.get_json()["defaultVersion"], "v2.0")

        range_data = self.create_range()
        medium = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        medium["objects"] = [
            {"type": "target", "xM": 1, "yM": 5, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {}},
            {"type": "target", "xM": 2, "yM": 5, "widthM": .55, "heightM": .95, "rotation": 0, "label": "", "properties": {}},
        ]
        response = self.client.post("/api/stages", json=medium)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Mittel")

        hard = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        hard["objects"] = [*self.target_objects(4), *self.backstop_objects(1)]
        response = self.client.post("/api/stages", json=hard)
        hard_stage = response.get_json()
        self.assertEqual(hard_stage["difficultyCalculated"], "Schwer")
        self.assertLessEqual(len(hard_stage["difficultyReasons"]), 1)

        simple = self.stage_payload(range_data["id"], weapon="kurzwaffe", training_type="statisch")
        simple["objects"] = self.target_objects(2)
        response = self.client.post("/api/stages", json=simple)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Leicht")

        pdf = self.client.get(f"/api/stages/{hard_stage['id']}/pdf")
        pdf_text = pdf.data.decode("latin1", errors="ignore")
        self.assertIn("SHRUUM's StageBuilder", pdf_text)
        self.assertIn("Internal Training Use Only", pdf_text)
        self.assertIn("Author: Jannis", pdf_text)
        self.assertNotIn("Co" + "ach", pdf_text)
        self.assertIn("Version v1.0", pdf_text)
        self.assertIn("Seite 1/2", pdf_text)
        self.assertIn("Seite 2/2", pdf_text)
        self.assertNotIn("Schwere Schwierigkeit:", pdf_text)

    def test_strict_heavy_difficulty_rule(self):
        range_data = self.create_range()

        three_targets_with_backstop = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        three_targets_with_backstop["objects"] = [*self.target_objects(3), *self.backstop_objects(1)]
        response = self.client.post("/api/stages", json=three_targets_with_backstop)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Mittel")

        four_targets_no_backstop = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        four_targets_no_backstop["objects"] = self.target_objects(4)
        response = self.client.post("/api/stages", json=four_targets_no_backstop)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Mittel")

        four_targets_with_backstop = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="dynamisch")
        four_targets_with_backstop["objects"] = [*self.target_objects(4), *self.backstop_objects(1)]
        response = self.client.post("/api/stages", json=four_targets_with_backstop)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Schwer")

        handgun_dynamic = self.stage_payload(range_data["id"], weapon="kurzwaffe", training_type="dynamisch")
        handgun_dynamic["objects"] = [*self.target_objects(6), *self.backstop_objects(2)]
        response = self.client.post("/api/stages", json=handgun_dynamic)
        self.assertEqual(response.get_json()["difficultyCalculated"], "Mittel")

        two_gun_static = self.stage_payload(range_data["id"], weapon="kurzwaffe_langwaffe", training_type="statisch")
        two_gun_static["objects"] = [*self.target_objects(4), *self.backstop_objects(1)]
        response = self.client.post("/api/stages", json=two_gun_static)
        self.assertNotEqual(response.get_json()["difficultyCalculated"], "Schwer")

    def test_legacy_author_setting_is_migrated_for_pdf(self):
        settings = self.client.put(
            "/api/settings",
            json={"co" + "achName": "Legacy Name", "footerText": "Internal Use Only", "defaultVersion": "v1.0"},
        )
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.get_json()["authorName"], "Legacy Name")
        self.assertNotIn("co" + "achName", settings.get_json())

        range_data = self.create_range()
        stage = self.client.post("/api/stages", json=self.stage_payload(range_data["id"])).get_json()
        pdf = self.client.get(f"/api/stages/{stage['id']}/pdf")
        pdf_text = pdf.data.decode("latin1", errors="ignore")
        self.assertIn("Author: Legacy Name", pdf_text)
        self.assertNotIn("Co" + "ach", pdf_text)

    def test_auto_versioning_only_on_real_changes_and_duplicate_resets(self):
        range_data = self.create_range()
        payload = self.stage_payload(range_data["id"])
        response = self.client.post("/api/stages", json=payload)
        self.assertEqual(response.status_code, 201)
        stage = response.get_json()
        self.assertEqual(stage["version"], "v1.0")
        first_updated = stage["updatedAt"]

        loaded = self.client.get(f"/api/stages/{stage['id']}").get_json()["stage"]
        unchanged = self.client.put(f"/api/stages/{stage['id']}", json=loaded).get_json()
        self.assertEqual(unchanged["version"], "v1.0")
        self.assertEqual(unchanged["updatedAt"], first_updated)

        loaded["description"] = "Geändert"
        changed = self.client.put(f"/api/stages/{stage['id']}", json=loaded).get_json()
        self.assertEqual(changed["version"], "v1.1")

        changed["trainingGoal"] = "Anderes Ziel"
        changed_again = self.client.put(f"/api/stages/{stage['id']}", json=changed).get_json()
        self.assertEqual(changed_again["version"], "v1.2")

        duplicate = self.client.post(f"/api/stages/{stage['id']}/duplicate").get_json()
        self.assertEqual(duplicate["version"], "v1.0")


if __name__ == "__main__":
    unittest.main()
