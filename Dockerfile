FROM public-cn-beijing.cr.volces.com/public/node:18-alpine

WORKDIR /opt/application

COPY . /opt/application

RUN sed -i 's/\r$//' /opt/application/run.sh \
 && chmod a+x /opt/application/run.sh

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

EXPOSE 8000

CMD ["/opt/application/run.sh"]
