// GENERATED from back/data/agronomy.json — do not edit by hand.
// The Python engine loads the same coefficients from back/data/agronomy.json;
// tests/test_agronomy_parity.py fails if the two drift apart.
export const AGRO = {
  "_meta": {
    "version": 1,
    "purpose": "Agronomic coefficients used by both the Python engine (back/app/simulator) and the browser engine (front/src/lib/engine.js). Single source of truth: keep the two copies byte-identical.",
    "sources": [
      {
        "id": "fao56",
        "citation": "Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop evapotranspiration: Guidelines for computing crop water requirements. FAO Irrigation and Drainage Paper 56.",
        "used_for": "Single crop coefficients (Kc ini/mid/end), stage lengths, and the ETc = Kc x ET0 relation."
      },
      {
        "id": "fao29",
        "citation": "Ayers, R.S., Westcot, D.W. (1985). Water quality for agriculture. FAO Irrigation and Drainage Paper 29 Rev. 1 (after Maas & Hoffman, 1977).",
        "used_for": "Crop salinity tolerance (ECe threshold and yield decline per dS/m). Informational only in this prototype: the field salinity input is not measured."
      },
      {
        "id": "fao-ecocrop",
        "citation": "FAO EcoCrop crop fact sheets (temperature and pH requirement ranges).",
        "used_for": "Approximate optimal mean-temperature and soil-pH ranges; treated as broad suitability bands, not cultivar-specific limits."
      }
    ],
    "caveats": [
      "Kc values are FAO-56 single-crop coefficients for a sub-humid climate with moderate wind; they are not locally calibrated for Moroccan conditions.",
      "Optimal temperature and pH bands are broad literature ranges used to build a 0-1 suitability index; they are approximations, not measured crop responses.",
      "Growing windows are typical Moroccan sowing-to-harvest months used to select which NASA POWER monthly statistics apply; they are not field-observed phenology.",
      "ETc = Kc x ET0 and the deficit against effective rainfall are a simplified seasonal water balance. They ignore soil water storage, irrigation efficiency, capillary rise, runoff and salinity leaching."
    ]
  },
  "salinity_input_note": "SoilGrids does not publish soil salinity. The field NaCl value is a prototype default, so salinity is reported for information and is excluded from the score.",
  "crops": {
    "winter_wheat": {
      "name": "Winter wheat",
      "kc_ini": 0.4,
      "kc_mid": 1.15,
      "kc_end": 0.3,
      "stages_days": {
        "ini": 25,
        "dev": 60,
        "mid": 75,
        "late": 50
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        12,
        25
      ],
      "t_abs": [
        0,
        35
      ],
      "ph_range": [
        6,
        8.5
      ],
      "ec_threshold_ds_m": 6,
      "ec_decline_per_ds_m": 0.071
    },
    "barley": {
      "name": "Barley",
      "kc_ini": 0.35,
      "kc_mid": 1.1,
      "kc_end": 0.3,
      "stages_days": {
        "ini": 25,
        "dev": 55,
        "mid": 70,
        "late": 50
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        12,
        25
      ],
      "t_abs": [
        0,
        35
      ],
      "ph_range": [
        6.5,
        8.8
      ],
      "ec_threshold_ds_m": 8,
      "ec_decline_per_ds_m": 0.05
    },
    "faba_beans": {
      "name": "Faba beans",
      "kc_ini": 0.5,
      "kc_mid": 1.15,
      "kc_end": 0.3,
      "stages_days": {
        "ini": 20,
        "dev": 45,
        "mid": 55,
        "late": 30
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        15,
        22
      ],
      "t_abs": [
        3,
        30
      ],
      "ph_range": [
        6,
        8.5
      ],
      "ec_threshold_ds_m": 1.6,
      "ec_decline_per_ds_m": 0.096
    },
    "chickpeas": {
      "name": "Chickpeas",
      "kc_ini": 0.4,
      "kc_mid": 1.1,
      "kc_end": 0.35,
      "stages_days": {
        "ini": 20,
        "dev": 35,
        "mid": 45,
        "late": 30
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        15,
        25
      ],
      "t_abs": [
        5,
        32
      ],
      "ph_range": [
        6,
        8.5
      ],
      "ec_threshold_ds_m": 1.6,
      "ec_decline_per_ds_m": 0.09
    },
    "lentils": {
      "name": "Lentils",
      "kc_ini": 0.4,
      "kc_mid": 1.1,
      "kc_end": 0.3,
      "stages_days": {
        "ini": 20,
        "dev": 35,
        "mid": 45,
        "late": 30
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        15,
        25
      ],
      "t_abs": [
        5,
        30
      ],
      "ph_range": [
        6,
        8
      ],
      "ec_threshold_ds_m": 1,
      "ec_decline_per_ds_m": 0.1
    },
    "sunflower": {
      "name": "Sunflower",
      "kc_ini": 0.35,
      "kc_mid": 1,
      "kc_end": 0.35,
      "stages_days": {
        "ini": 25,
        "dev": 35,
        "mid": 45,
        "late": 25
      },
      "window_months": [
        4,
        5,
        6,
        7,
        8
      ],
      "t_opt": [
        20,
        26
      ],
      "t_abs": [
        8,
        35
      ],
      "ph_range": [
        6,
        8
      ],
      "ec_threshold_ds_m": 4.8,
      "ec_decline_per_ds_m": 0.052
    },
    "sugar_beet": {
      "name": "Sugar beet",
      "kc_ini": 0.35,
      "kc_mid": 1.2,
      "kc_end": 0.7,
      "stages_days": {
        "ini": 30,
        "dev": 60,
        "mid": 80,
        "late": 40
      },
      "window_months": [
        10,
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        15,
        25
      ],
      "t_abs": [
        5,
        35
      ],
      "ph_range": [
        6.5,
        8.2
      ],
      "ec_threshold_ds_m": 7,
      "ec_decline_per_ds_m": 0.059
    },
    "sweet_potato": {
      "name": "Sweet potato",
      "kc_ini": 0.5,
      "kc_mid": 1.15,
      "kc_end": 0.65,
      "stages_days": {
        "ini": 20,
        "dev": 30,
        "mid": 60,
        "late": 30
      },
      "window_months": [
        5,
        6,
        7,
        8,
        9
      ],
      "t_opt": [
        21,
        30
      ],
      "t_abs": [
        12,
        38
      ],
      "ph_range": [
        5.5,
        6.8
      ],
      "ec_threshold_ds_m": 1.5,
      "ec_decline_per_ds_m": 0.09
    },
    "potato": {
      "name": "Potato",
      "kc_ini": 0.5,
      "kc_mid": 1.15,
      "kc_end": 0.75,
      "stages_days": {
        "ini": 25,
        "dev": 30,
        "mid": 45,
        "late": 30
      },
      "window_months": [
        2,
        3,
        4,
        5,
        6
      ],
      "t_opt": [
        15,
        22
      ],
      "t_abs": [
        7,
        30
      ],
      "ph_range": [
        5,
        7
      ],
      "ec_threshold_ds_m": 1.7,
      "ec_decline_per_ds_m": 0.09
    },
    "tomato": {
      "name": "Tomato",
      "kc_ini": 0.6,
      "kc_mid": 1.15,
      "kc_end": 0.8,
      "stages_days": {
        "ini": 30,
        "dev": 40,
        "mid": 40,
        "late": 25
      },
      "window_months": [
        4,
        5,
        6,
        7,
        8
      ],
      "t_opt": [
        20,
        28
      ],
      "t_abs": [
        10,
        35
      ],
      "ph_range": [
        6,
        7.5
      ],
      "ec_threshold_ds_m": 2.5,
      "ec_decline_per_ds_m": 0.09
    },
    "onion": {
      "name": "Onion",
      "kc_ini": 0.7,
      "kc_mid": 1.05,
      "kc_end": 0.75,
      "stages_days": {
        "ini": 15,
        "dev": 25,
        "mid": 70,
        "late": 40
      },
      "window_months": [
        11,
        12,
        1,
        2,
        3,
        4
      ],
      "t_opt": [
        15,
        25
      ],
      "t_abs": [
        5,
        32
      ],
      "ph_range": [
        6,
        7.8
      ],
      "ec_threshold_ds_m": 1.2,
      "ec_decline_per_ds_m": 0.08
    },
    "carrot": {
      "name": "Carrot",
      "kc_ini": 0.7,
      "kc_mid": 1.05,
      "kc_end": 0.95,
      "stages_days": {
        "ini": 20,
        "dev": 30,
        "mid": 30,
        "late": 30
      },
      "window_months": [
        10,
        11,
        12,
        1,
        2
      ],
      "t_opt": [
        15,
        22
      ],
      "t_abs": [
        5,
        30
      ],
      "ph_range": [
        6,
        7.5
      ],
      "ec_threshold_ds_m": 1,
      "ec_decline_per_ds_m": 0.11
    },
    "lettuce": {
      "name": "Lettuce",
      "kc_ini": 0.7,
      "kc_mid": 1,
      "kc_end": 0.95,
      "stages_days": {
        "ini": 20,
        "dev": 15,
        "mid": 20,
        "late": 20
      },
      "window_months": [
        10,
        11,
        12,
        1,
        2
      ],
      "t_opt": [
        12,
        20
      ],
      "t_abs": [
        3,
        28
      ],
      "ph_range": [
        6,
        7.5
      ],
      "ec_threshold_ds_m": 1.3,
      "ec_decline_per_ds_m": 0.13
    },
    "maize": {
      "name": "Maize",
      "kc_ini": 0.3,
      "kc_mid": 1.2,
      "kc_end": 0.6,
      "stages_days": {
        "ini": 25,
        "dev": 35,
        "mid": 45,
        "late": 20
      },
      "window_months": [
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "t_opt": [
        20,
        30
      ],
      "t_abs": [
        10,
        35
      ],
      "ph_range": [
        5.8,
        8
      ],
      "ec_threshold_ds_m": 1.7,
      "ec_decline_per_ds_m": 0.12
    },
    "sorghum": {
      "name": "Sorghum",
      "kc_ini": 0.35,
      "kc_mid": 1.1,
      "kc_end": 0.65,
      "stages_days": {
        "ini": 20,
        "dev": 35,
        "mid": 40,
        "late": 25
      },
      "window_months": [
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "t_opt": [
        25,
        32
      ],
      "t_abs": [
        12,
        40
      ],
      "ph_range": [
        5.5,
        8
      ],
      "ec_threshold_ds_m": 6.8,
      "ec_decline_per_ds_m": 0.16
    }
  }
}
