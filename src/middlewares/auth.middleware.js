const catchAsync = require('../helpers/catchAsync.helper');
const { Partner, User } = require("../models");
const AppError = require("../helpers/appError.helper");
const { authSchema } = require("../schemas/auth.schema");

exports.selectUser = permission => {
	return catchAsync(async (req, res, next) => {
		if (permission === 'PARTNER') {
			const secretKey = req.get('secret_key');
			if (!secretKey) {
				throw new AppError('Bạn không đủ quyền để truy cập !', 403);
			}
			const partner = await Partner.findOne({
				where: {
					secretKey
				}
			});

			if (!partner) {
				throw new AppError('Bạn không đủ quyền để truy cập !', 403);
			}
			res.locals.partner = partner;

			return next();
		}

		if (permission === 'USER') {

			const user = await User.findOne({
				where: {
					userId: req.body.userId
				}
			});

			if (!user) {
				throw new AppError('Bạn không đủ quyền để truy cập !', 403);
			}
			res.locals.user = user;

			return next();
		}

	});
}

exports.validatePartner = catchAsync(async (req, res, next) => {
	try {
		const { username, password } = req.body;
		await authSchema.validate({
			body: { username, password }
		});

		return next();
	} catch (e) {
		throw new AppError('Dữ liệu không hợp lệ !', 400);
	}
});