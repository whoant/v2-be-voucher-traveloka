const {
    Voucher,
    UserVoucher,
    Condition, sequelize, TypeVoucher, PartnerTypeVoucher, User, Partner, UserGiftCard, GiftCard,
} = require("../../models");
const AppError = require("../../helpers/appError.helper");
const { Op } = require("sequelize");
const { combineDescriptionVoucher } = require("../../helpers/combineDescription.helper");
const clientRedis = require('../../config/redis');
const { STATE_PROMOTION } = require("../../constants");
const { sha256 } = require("../../helpers/hash.helper");
const { v4: uuidv4 } = require('uuid');
const { VNDtoUSD } = require("../../helpers/currencyConverter.helper");
const Paypal = require('../Paypal');
const _ = require('lodash');
const moment = require('moment-timezone');
moment().tz("Asia/Ho_Chi_Minh").format();

class UserService {
    constructor(user, partnerTypeVoucher) {
        this.user = user;
        this.partnerTypeVoucher = partnerTypeVoucher;
    }

    async getVoucherOwned(type) {
        let conditionUserVoucher = {
            userId: this.user.id,
            state: STATE_PROMOTION.OWNED,
        };

        let conditionVoucher = {}

        if (type === 'available') {
            conditionVoucher = {
                ...conditionVoucher,
                effectiveAt: {
                    [Op.lte]: Date.now()
                },
                expirationAt: {
                    [Op.gte]: Date.now()
                },
            };

        } else if (type === 'expired') {
            conditionVoucher = {
                ...conditionVoucher,
                expirationAt: {
                    [Op.lt]: Date.now()
                },
            }
        } else if (type === 'used') {
            conditionUserVoucher.state = STATE_PROMOTION.DONE;
        }

        const userVouchers = await UserVoucher.findAll({
            where: conditionUserVoucher,
            nest: true,
            raw: true
        });

        const listVouchers = await Voucher.findAll({
            where: {
                id: {
                    [Op.in]: userVouchers.map(userVoucher => userVoucher.voucherId)
                },
                ...conditionVoucher
            },
            include: [{
                model: Condition,
                attributes: ['threshold', 'discount', 'maxAmount']
            }, {
                model: PartnerTypeVoucher,
            }],
            attributes: {
                exclude: ['updatedAt', 'imageUrl', 'limitUse', 'id']
            }
        });

        const listTypeVouchers = await TypeVoucher.findAll({
            nest: true,
            raw: true,
            attributes: [
                ['id', 'typeVoucherId'],
                'type'
            ]
        });

        const mapTypeVouchers = new Map();
        listTypeVouchers.forEach(item => {
            mapTypeVouchers.set(item.typeVoucherId, item.type);
        });

        const vouchers = listVouchers.map(voucher => {
            const { title, content, effectiveAt, voucherCode, amount, expirationAt, createdAt } = voucher;
            const { typeVoucherId } = voucher.PartnerTypeVoucher;

            return {
                title, content, effectiveAt, voucherCode, amount, expirationAt, createdAt,
                type: mapTypeVouchers.get(typeVoucherId),
                description: combineDescriptionVoucher(voucher.Condition)
            };
        })

        return vouchers;
    }

    async getVoucherEligible() {
        const listVoucherDone = (await UserVoucher.findAll({
            where: {
                userId: this.getUserId(),
                state: STATE_PROMOTION.DONE,
            },
            attributes: ['voucherId'],
            raw: true
        })).map(({ voucherId }) => voucherId);

        const listUserVoucherHave = await UserVoucher.findAll({
            where: {
                userId: this.getUserId(),
            },
            attributes: ['voucherId'],
            raw: true
        });

        const listVoucherNotBuy = (await Voucher.findAll({
            where: {
                amount: {
                    [Op.gt]: 0
                },
                id: {
                    [Op.notIn]: listUserVoucherHave.map(({ voucherId }) => voucherId)
                }
            },
            attributes: ['id'],
            raw: true
        })).map(({ id }) => id);

        const listVoucherDiff = [...new Set([...listVoucherDone, ...listVoucherNotBuy])]

        const timeCurrent = moment();

        const vouchers = await Voucher.findAll({
            where: {
                id: {
                    [Op.notIn]: listVoucherDiff
                },
                effectiveAt: {
                    [Op.lte]: timeCurrent
                },
                expirationAt: {
                    [Op.gte]: timeCurrent
                },
                PartnerTypeVoucherId: this.partnerTypeVoucher.getId()
            },
            include: {
                model: Condition,
                attributes: ['threshold', 'discount', 'maxAmount']
            },
            attributes: {
                exclude: ['createdAt', 'updatedAt', 'partnerId', 'id']
            },
            raw: true,
            nest: true
        });

        return vouchers.map(voucher => {
            return {
                ...voucher,
                description: combineDescriptionVoucher(voucher.Condition)
            }
        });
    }

    async preOrder(orderInfo) {
        const { code, transactionId, amount } = orderInfo;
        const partnerTypeVoucher = this.partnerTypeVoucher;

        const voucher = await this.checkVoucherValid(code);
        const amountAfter = await this.checkVoucherCondition(voucher, amount);
        const cacheVoucherId = this.generateVoucherId(code, partnerTypeVoucher.getId());
        const isExists = await clientRedis.exists(cacheVoucherId);

        if (!isExists) {
            await clientRedis.set(cacheVoucherId, JSON.stringify({
                transactionId,
                voucherId: voucher.id,
                userId: this.getUserId(),
                amount,
                isBuy: voucher.isBuy(),
                amountAfter: amount - amountAfter
            }), {
                EX: 60 * 5
            });
        } else {
            const parseCache = JSON.parse(await clientRedis.get(cacheVoucherId));
            if (parseCache.transactionId !== transactionId) {
                return false;
            }
        }

        return cacheVoucherId;
    }

    async cancelOrder(orderId) {
        await clientRedis.del(orderId);

        return true;
    }

    async updateStateVoucher(orderId) {
        let orderInfo = await clientRedis.get(orderId);

        if (!orderInfo) return false;
        const { userId, voucherId, transactionId, amount, amountAfter, isBuy } = JSON.parse(orderInfo);

        try {
            return await sequelize.transaction(async t => {
                let newUserVoucher;

                if (isBuy) {
                    newUserVoucher = await UserVoucher.findOne({
                        where: {
                            userId,
                            voucherId,
                        }
                    });
                    newUserVoucher.state = STATE_PROMOTION.DONE;
                    newUserVoucher.save({ transaction: t });

                } else {
                    newUserVoucher = await UserVoucher.create({
                        userId,
                        voucherId,
                        state: STATE_PROMOTION.DONE
                    }, {
                        transaction: t
                    });
                }

                await Promise.all([
                    clientRedis.del(orderId),
                    newUserVoucher.createDetailUserVoucher({
                        transactionId, amount, amountAfter,
                    }, {
                        transaction: t
                    })
                ]);

                return true;
            });
        } catch (e) {

            return Promise.reject(e);
        }
    }

    getUserId() {
        return this.user.dataValues.id;
    }

    async checkVoucherCondition(voucher, amount) {
        const condition = await voucher.getCondition();

        if (Number(amount) < Number(condition.threshold)) {
            throw new AppError("Không đủ điều kiện", 400);
        }

        let deduct = Number(condition.maxAmount);
        if (Number(condition.discount) > 0) {
            let deductTemp = Number(amount) * Number(condition.discount) / 100;
            if (deductTemp < deduct) deduct = deductTemp;
        }

        return Math.round(deduct);
    }

    generateVoucherId(code, partnerTypeVoucherId) {
        return `${code}:${this.getUserId()}:${partnerTypeVoucherId}`;
    }

    async checkVoucherValid(code) {
        const voucher = await Voucher.findOne({
            where: {
                voucherCode: code,
                effectiveAt: {
                    [Op.lte]: Date.now()
                },
                expirationAt: {
                    [Op.gte]: Date.now()
                },
                PartnerTypeVoucherId: this.partnerTypeVoucher.getId()
            }
        });

        if (!voucher) throw new AppError("Voucher không tồn tại !", 400);
        const userVoucher = await UserVoucher.findOne({
            where: {
                voucherId: voucher.id,
                userId: this.getUserId()
            }
        });


        if ((!userVoucher && !voucher.isBuy()) || (userVoucher && userVoucher.isOwned())) return voucher;

        throw new AppError('Voucher không tồn tại !', 400);
    }

    async getVoucherCanBuy(user, type) {
        const typeVoucher = await TypeVoucher.findOne({
            where: {
                type,
            },
        });

        const partnerTypeVoucher = await PartnerTypeVoucher.findAll({
            where: {
                typeVoucherId: typeVoucher.id
            },
            attributes: {
                include: ['id']
            },
            raw: true,
            nest: true
        });

        const listVouchersExist = await UserVoucher.findAll({
            where: {
                userId: user.id
            },
            attributes: {
                include: ['voucherId']
            },
            raw: true
        });

        const timeCurrent = moment();

        const vouchers = await Voucher.findAll({
            where: {
                PartnerTypeVoucherId: {
                    [Op.in]: partnerTypeVoucher.map(item => item.id)
                },
                amount: {
                    [Op.gt]: 0
                },
                effectiveAt: {
                    [Op.lte]: timeCurrent
                },
                expirationAt: {
                    [Op.gte]: timeCurrent
                },
                id: {
                    [Op.notIn]: listVouchersExist.map(item => item.voucherId)
                }
            },
            include: [{
                model: Condition,
                attributes: ['threshold', 'discount', 'maxAmount']
            }, {
                model: PartnerTypeVoucher,

            }],
            attributes: {
                include: ['id', 'title', 'content', 'voucherCode', 'imageUrl', 'amount', 'effectiveAt', 'expirationAt']
            },
            raw: true,
            nest: true
        });

        const countUserVoucher = await Promise.all(vouchers.map(voucher => {
            return UserVoucher.count({
                where: {
                    voucherId: voucher.id
                }
            });
        }));

        const res = [];
        vouchers.forEach((voucher, index) => {
            const { id, title, content, effectiveAt, expirationAt, amount, imageUrl, voucherCode, limitUse } = voucher;
            if (countUserVoucher[index] >= limitUse) return;
            res.push({
                id, title, content, effectiveAt, expirationAt, amount, imageUrl, voucherCode,
                description: combineDescriptionVoucher(voucher.Condition),
                partnerId: voucher.PartnerTypeVoucher.partnerId
            });
        });

        return res;
    }

    async preBuyVoucher(code) {
        const voucher = await Voucher.findOne({
            where: {
                voucherCode: code,
                PartnerTypeVoucherId: this.partnerTypeVoucher.getId(),
                amount: {
                    [Op.gt]: 0
                },
                effectiveAt: {
                    [Op.lte]: Date.now()
                },
                expirationAt: {
                    [Op.gte]: Date.now()
                },

            },
            include: [{
                model: Condition,
                attributes: ['threshold', 'discount', 'maxAmount']
            }],
        });

        if (!voucher) throw new AppError("Voucher không tồn tại !", 400);

        const countUserVoucher = await UserVoucher.count({
            where: {
                voucherId: voucher.id,
            }
        });

        const countRedis = await clientRedis.keys(this.createTransactionId(voucher.id, "*"));

        if (countUserVoucher + countRedis.length > voucher.limitUse) {
            throw new AppError("Voucher này hiện tại đang hết !", 400);
        }

        const userVoucher = await UserVoucher.findOne({
            where: {
                voucherId: voucher.id,
                userId: this.user.id
            }
        });

        if (userVoucher) throw new AppError("Voucher này bạn đã sở hữu !", 400);

        const transactionId = this.createTransactionId(voucher.id, this.user.id);

        const isExists = await clientRedis.exists(transactionId);
        if (isExists) throw new AppError("Bạn đang thực hiện giao dịch với voucher này !", 400);

        await clientRedis.set(transactionId, JSON.stringify({
            voucherId: voucher.id,
            userId: this.user.id,
            email: this.user.email,
            amount: voucher.amount,
            title: voucher.title,
            description: combineDescriptionVoucher(voucher.Condition)
        }), {
            EX: 60 * 5
        });

        return transactionId;
    }

    async buyVoucher(transactionId) {
        return new Promise(async (resolve, reject) => {
            try {
                const isExists = await clientRedis.exists(transactionId);
                if (!isExists) throw new AppError("Giao dịch này không tồn tại !", 400);

                const { amount, title, voucherId, userId } = JSON.parse(await clientRedis.get(transactionId));
                const paymentId = await Paypal.createOrder(title, VNDtoUSD(amount));

                const ttl = await clientRedis.ttl(transactionId);
                await clientRedis.set(paymentId, JSON.stringify({ amount, title, voucherId, userId }), {
                    EX: ttl
                });

                resolve(paymentId);
            } catch (e) {
                reject(e);
            }
        });
    }

    createTransactionId(voucherId, userId = '') {
        return `buy:${voucherId}:${userId}`;
    }

    async getGiftCardEligible() {
    }

    async getGiftCanExchange(type) {

        const typeVoucher = await TypeVoucher.findOne({
            where: {
                type,
            },
        });

        const partnerTypeId = (await PartnerTypeVoucher.findAll({
            where: {
                typeVoucherId: typeVoucher.id
            },
            attributes: {
                include: ['id']
            },
            raw: true,
            nest: true
        })).map(({ id }) => id);

        const giftCardsDone = (await UserGiftCard.findAll({
            where: {
                userId: this.getUserId(),
            },
            attributes: ['giftCardId'],
            raw: true
        })).map(({ giftCardId }) => giftCardId);

        const timeCurrent = moment();

        const giftCards = await GiftCard.findAll({
            where: {
                id: {
                    [Op.notIn]: giftCardsDone
                },
                effectiveAt: {
                    [Op.lte]: timeCurrent
                },
                expirationAt: {
                    [Op.gte]: timeCurrent
                },
                partnerTypeId: {
                    [Op.in]: partnerTypeId
                }
            },
            raw: true,
            nest: true
        });

        const countUserGiftCard = await Promise.all(giftCards.map(giftCard => {
            return UserGiftCard.count({
                where: {
                    giftCardId: giftCard.id
                }
            });
        }));

        const res = [];
        giftCards.forEach((giftCard, index) => {
            const {
                title,
                content,
                effectiveAt,
                expirationAt,
                pointExchange,
                imageUrl,
                giftCardCode,
                limitUse
            } = giftCard;
            if (countUserGiftCard[index] >= limitUse) return;
            res.push({
                title, content, effectiveAt, expirationAt, pointExchange, imageUrl, giftCardCode,
                description: combineDescriptionVoucher(giftCard),
            });
        });

        return res;
    }

    async exchangeGift(giftCardCode) {
        const pointCurrent = 100;

        const giftCardItem = await GiftCard.findOne({
            where: {
                giftCardCode
            },
        });

        if (giftCardItem.pointExchange > pointCurrent) throw new AppError("Số điểm của bạn không đủ để đổi", 400);

        const countUserGiftCard = await UserGiftCard.count({
            where: {
                giftCardId: giftCardItem.id
            }
        });

        if (countUserGiftCard > giftCardItem.limitUse) throw new AppError("Thẻ quà tặng này đã hết lượng", 400);

        await UserGiftCard.create({
            userId: this.getUserId(),
            giftCardId: giftCardItem.id
        });
    }

}

module.exports = UserService;