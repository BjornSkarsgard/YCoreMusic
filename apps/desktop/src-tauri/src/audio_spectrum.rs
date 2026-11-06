//! Bounded analysis of our captured audio. Only frequency magnitudes leave this
//! module; no samples are retained beyond the rolling analysis window.
use std::f32::consts::PI;

const SIZE: usize = 2048;
pub const BANDS: usize = 48;

pub struct Spectrum {
    samples: [f32; SIZE],
    cursor: usize,
    sample_rate: f32,
}

impl Spectrum {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            samples: [0.0; SIZE],
            cursor: 0,
            sample_rate: sample_rate.max(1) as f32,
        }
    }

    pub fn push_stereo(&mut self, samples: &[f32]) {
        for frame in samples.as_chunks::<2>().0 {
            // Preserve anti-phase stereo energy by choosing the larger channel.
            // Averaging L+R would incorrectly erase valid anti-phase signals.
            let clean = |v: f32| {
                if v.is_finite() {
                    v.clamp(-1.0, 1.0)
                } else {
                    0.0
                }
            };
            let left = clean(frame[0]);
            let right = clean(frame[1]);
            self.push(if left.abs() >= right.abs() {
                left
            } else {
                right
            });
        }
    }

    #[cfg(any(target_os = "windows", test))]
    pub fn silence(&mut self, frames: usize) {
        if frames >= SIZE {
            self.samples.fill(0.0);
            self.cursor = 0;
        } else {
            for _ in 0..frames {
                self.push(0.0);
            }
        }
    }

    fn push(&mut self, sample: f32) {
        self.samples[self.cursor] = sample;
        self.cursor = (self.cursor + 1) % SIZE;
    }

    pub fn bands(&self) -> [f32; BANDS] {
        let mut real = [0.0; SIZE];
        let mut imag = [0.0; SIZE];
        for (i, value) in real.iter_mut().enumerate() {
            let hann = 0.5 - 0.5 * (2.0 * PI * i as f32 / (SIZE - 1) as f32).cos();
            *value = self.samples[(self.cursor + i) % SIZE] * hann;
        }
        // In-place radix-2 FFT with fixed storage and bounded work.
        for i in 0..SIZE {
            let j = i.reverse_bits() >> (usize::BITS - SIZE.trailing_zeros());
            if i < j {
                real.swap(i, j);
            }
        }
        let mut width = 2;
        while width <= SIZE {
            for base in (0..SIZE).step_by(width) {
                for offset in 0..width / 2 {
                    let angle = -2.0 * PI * offset as f32 / width as f32;
                    let (sin, cos) = angle.sin_cos();
                    let a = base + offset;
                    let b = a + width / 2;
                    let r = cos * real[b] - sin * imag[b];
                    let im = sin * real[b] + cos * imag[b];
                    real[b] = real[a] - r;
                    imag[b] = imag[a] - im;
                    real[a] += r;
                    imag[a] += im;
                }
            }
            width *= 2;
        }
        let mut bands = [0.0_f32; BANDS];
        let upper = 16000.0_f32.min(self.sample_rate / 2.0);
        if upper <= 30.0 {
            return bands;
        }
        for bin in 1..SIZE / 2 {
            let hz = bin as f32 * self.sample_rate / SIZE as f32;
            if hz < 30.0 || hz >= upper {
                continue;
            }
            let band = ((hz / 30.0).ln() / (upper / 30.0).ln() * BANDS as f32).floor() as usize;
            let amplitude = real[bin].hypot(imag[bin]) * 4.0 / SIZE as f32;
            if let Some(value) = bands.get_mut(band) {
                *value = value.max(amplitude.min(1.0));
            }
        }
        bands
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_zero_and_clears_previous_audio() {
        let mut spectrum = Spectrum::new(44100);
        assert_eq!(spectrum.bands(), [0.0; BANDS]);
        spectrum.push_stereo(&[0.5; SIZE * 2]);
        spectrum.silence(SIZE);
        assert_eq!(spectrum.bands(), [0.0; BANDS]);
    }

    #[test]
    fn dominant_band_tracks_frequency_and_preserves_antiphase() {
        for rate in [44100, 48000] {
            for hz in [100.0_f32, 1000.0, 8000.0] {
                let mut spectrum = Spectrum::new(rate);
                let samples: Vec<f32> = (0..SIZE * 3)
                    .flat_map(|i| {
                        let sample = 0.5 * (2.0 * PI * hz * i as f32 / rate as f32).sin();
                        [sample, -sample]
                    })
                    .collect();
                spectrum.push_stereo(&samples);
                let bands = spectrum.bands();
                let (dominant, amplitude) = bands
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .unwrap();
                let expected =
                    ((hz / 30.0).ln() / (16000.0_f32 / 30.0).ln() * BANDS as f32).floor() as usize;
                assert!(dominant.abs_diff(expected) <= 1, "{rate} Hz, {hz} Hz");
                assert!(*amplitude > 0.3 && *amplitude <= 0.51);
            }
        }
    }

    #[test]
    fn invalid_samples_never_produce_nonfinite_bands() {
        let mut spectrum = Spectrum::new(44100);
        spectrum.push_stereo(&[f32::NAN, f32::INFINITY, -f32::INFINITY, 0.0]);
        assert_eq!(spectrum.bands(), [0.0; BANDS]);
        spectrum.push_stereo(&[f32::MAX; SIZE * 2]);
        assert!(spectrum.bands().iter().all(|v| v.is_finite() && *v <= 1.0));
    }
}
