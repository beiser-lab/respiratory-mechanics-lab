# Respiratory Mechanics Lab

Browser-based pulmonary physiology teaching model for MEDC 30504 (Tissues, Cells & Organ Physiology), Pritzker School of Medicine. Open the published website; no installation or GitHub account is required.

Live site: https://beiser-lab.github.io/respiratory-mechanics-lab/

## Status

Experimental teaching model. The first module covers lung and chest wall statics: students change lung compliance, chest wall compliance, inward load on the chest wall, and respiratory muscle strength, then follow the relaxation pressure–volume curves, FRC, TLC, RV, VC, ERV, recoil pressures, and compliances. The second page, Pulmonary function tests (`pft.html`), follows the MEDC 30504 PFT small groups: spirometry tracing with volumes and capacities, flow-volume loop, volume-time curve, a PFT report (plethysmography, spirometry, slow VC, DLCO), and patients with emphysema, asthma (with bronchodilator), ILD, obesity, respiratory muscle weakness (upright and supine), fixed upper airway obstruction, and anemia. Not for patient care.

It shares its look with [Circulation Lab](https://github.com/beiser-lab/circulation-lab) so the two can later be combined.

## Model

The lung and chest wall share one volume, so at each volume their recoil pressures add:

    Prs(V) = PL(V) + Pcw(V)        and so        1/Crs = 1/CL + 1/Ccw

These are compliances in series. Adding the two volumes at the same pressure (the parallel rule) gives the wrong combined curve.

- Lung: Salazar–Knowles exponential, V = Vmax − (Vmax − V0)·exp(−kP), with V0 1.5 L and Vmax 6.4 L. Compliance changes rotate the curve about V0.
- Chest wall: logistic curve resting at 4.75 L, 72% VC (Rahn et al. 1946), with −5 cmH2O at FRC and about −20 cmH2O at RV. Compliance changes pivot it at 1.5 L (near RV), so a stiffer chest wall lowers its resting volume and FRC. Inward load (obesity, ascites, pregnancy) shifts the curve to the right.
- TLC and RV are the volumes where maximal inspiratory and expiratory muscle effort balance the system's recoil, calibrated to 6.0 L and 1.5 L.
- Healthy values: FRC 3.0 L, CL 0.25, Ccw 0.30, Crs 0.14 L/cmH2O.

On the statics page the model has no airway closure, so RV does not rise in emphysema there.

## PFT model

- Forced expiratory flow is the smallest of three limits: lung recoil over upstream (small-airway) resistance, PL(V)/Rus (Mead et al. 1967; Pride et al. 1967); expiratory effort; and a central-airway maximum. Rus rises as lung recoil falls. Airways close where Rus reaches ten times its open value, and that closing volume sets RV when it is above the chest wall limit (air trapping).
- Forced inspiration is effort limited. Fixed upper airway obstruction caps flow in both directions.
- DLCO uses Roughton–Forster, 1/DLCO = 1/DM + 1/(θ·Vc), with θ proportional to hemoglobin and the ERS/ATS 2017 hemoglobin correction.
- "Predicted" values are the model's healthy adult, not reference equations.
- Not modeled: dynamic hyperinflation, effort variability, gas dilution volumes, and the extra lung volume of emphysema, so TLC rises less than in real patients.

## Development

Requires Node.js for tests and Python 3 for the local server.

```sh
npm test
npm start
```

Open http://localhost:4174 (statics) or http://localhost:4174/pft.html (PFTs). Application files are in `dist/`. GitHub Pages serves the `gh-pages` branch, containing only these static files.

Publish updates after tests pass:

```sh
git push origin main
git subtree push --prefix dist origin gh-pages
```

## References

1. Rahn H, Otis AB, Chadwick LE, Fenn WO. The pressure-volume diagram of the thorax and lung. Am J Physiol. 1946;146(2):161–178. doi:10.1152/ajplegacy.1946.146.2.161
2. Chatburn RL, Daoud EG. Ventilation. In: Kacmarek RM, Stoller JK, Heuer AJ, eds. Egan's Fundamentals of Respiratory Care. 10th ed. Mosby; 2013. Figure 10-7, modified from Beachey W. Respiratory Care Anatomy and Physiology. 2nd ed. Mosby; 2007.
3. Yartsev A. Elastic properties of the respiratory system. Deranged Physiology. https://derangedphysiology.com/main/cicm-primary-exam/respiratory-system/Chapter-032/elastic-properties-respiratory-system
4. Mead J, Turner JM, Macklem PT, Little JB. Significance of the relationship between lung recoil and maximum expiratory flow. J Appl Physiol. 1967;22(1):95–108.
5. Pride NB, Permutt S, Riley RL, Bromberger-Barnea B. Determinants of maximal expiratory flow from the lungs. J Appl Physiol. 1967;23(5):646–662.
6. Hyatt RE, Schilder DP, Fry DL. Relationship between maximum expiratory flow and degree of lung inflation. J Appl Physiol. 1958;13(3):331–336.
7. Roughton FJW, Forster RE. Relative importance of diffusion and chemical reaction rates in determining rate of exchange of gases in the human lung. J Appl Physiol. 1957;11(2):290–302.
8. Graham BL, et al. Standardization of spirometry 2019 update. Am J Respir Crit Care Med. 2019;200(8):e70–e88.
9. Graham BL, et al. 2017 ERS/ATS standards for single-breath carbon monoxide uptake in the lung. Eur Respir J. 2017;49(1):1600016.
10. Stanojevic S, et al. ERS/ATS technical standard on interpretive strategies for routine lung function tests. Eur Respir J. 2022;60(1):2101499.
