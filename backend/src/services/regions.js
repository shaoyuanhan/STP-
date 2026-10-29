// 数据来源：modood/Administrative-divisions-of-China，2023 年统计用区划代码。
const source = require('../data/pca-code.json');

const regionOptions = source.map((province) => ({
  label: province.name,
  value: `${province.code}0000`,
  children: province.children.map((city) => ({
    label: city.name,
    value: `${city.code}00`,
    children: city.children.map((district) => ({
      label: district.name,
      value: district.code,
    })),
  })),
}));

const regionByCodes = new Map();
for (const province of source) {
  const provinceCode = `${province.code}0000`;
  for (const city of province.children) {
    const cityCode = `${city.code}00`;
    for (const district of city.children) {
      regionByCodes.set(`${provinceCode}:${cityCode}:${district.code}`, {
        province_code: provinceCode,
        province_name: province.name,
        city_code: cityCode,
        city_name: city.name,
        district_code: district.code,
        district_name: district.name,
      });
    }
  }
}

function resolveRegion(provinceCode, cityCode, districtCode) {
  return regionByCodes.get(`${provinceCode}:${cityCode}:${districtCode}`) || null;
}

module.exports = { regionOptions, resolveRegion };
